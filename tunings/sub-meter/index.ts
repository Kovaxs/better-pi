import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readCachedSnapshot, writeCachedSnapshot } from "./src/cache.ts";
import { formatPercent, formatReset, formatUsageLine, windowLabel } from "./src/format.ts";
import { selectWindows } from "./src/select.ts";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./src/settings.ts";
import { adapterFor } from "./src/providers/index.ts";
import { ProviderError, type DisplayMode, type ProviderId, type Settings, type UsageAdapter, type UsageSnapshot } from "./src/types.ts";

const WIDGET_KEY = "sub-meter";
const completionValues = ["", "status", "refresh", "rotate", "both", "session", "week"];

type RefreshResult = "updated" | "unchanged" | "unsupported" | "blocked" | "failed";

export default function (pi: ExtensionAPI) {
	let settings: Settings = { ...DEFAULT_SETTINGS };
	let settingsPath = "";
	let cachePath = "";
	let snapshot: UsageSnapshot | undefined;
	let activeProvider: ProviderId | undefined;
	let rotationIndex = 0;
	let timer: ReturnType<typeof setInterval> | undefined;
	let abortController: AbortController | undefined;
	let sessionContext: ExtensionContext | undefined;
	let stopping = false;
	let activation = 0;
	let widgetVersion = 0;
	let invalidateWidget: (() => void) | undefined;
	let requestRender: (() => void) | undefined;
	const inFlight = new Map<ProviderId, Promise<RefreshResult>>();
	const failures = new Map<ProviderId, number>();
	const retryAfter = new Map<ProviderId, number>();
	const blocked = new Set<ProviderId>();
	const lastErrors = new Map<ProviderId, string>();

	function render(): void {
		widgetVersion++;
		invalidateWidget?.();
		requestRender?.();
	}

	function clearWidget(ctx: ExtensionContext): void {
		snapshot = undefined;
		if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
		invalidateWidget = undefined;
		requestRender = undefined;
	}

	function installWidget(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
			let cachedWidth: number | undefined;
			let cachedVersion: number | undefined;
			let cachedLines: string[] = [];
			const invalidate = () => {
				cachedWidth = undefined;
				cachedVersion = undefined;
			};
			const request = () => tui.requestRender();
			invalidateWidget = invalidate;
			requestRender = request;
			return {
				invalidate,
				render(width: number): string[] {
					if (cachedWidth === width && cachedVersion === widgetVersion) return cachedLines;
					const windows = selectWindows(snapshot?.windows ?? [], settings.display, rotationIndex);
					const line = formatUsageLine(windows, width, settings, Date.now(), {
						style: (text, level) => theme.fg(level === "normal" ? "text" : level, text),
						visibleWidth,
						truncateToWidth,
					});
					cachedWidth = width;
					cachedVersion = widgetVersion;
					cachedLines = line ? [line] : [];
					return cachedLines;
				},
				dispose() {
					if (invalidateWidget === invalidate) invalidateWidget = undefined;
					if (requestRender === request) requestRender = undefined;
				},
			};
		}, { placement: "aboveEditor" });
	}

	function snapshotMeasuredAt(): number {
		return snapshot?.measuredAt ?? 0;
	}

	function isStale(now: number): boolean {
		return !snapshot || now - snapshot.measuredAt >= settings.refreshSeconds * 1_000;
	}

	async function activate(ctx: ExtensionContext): Promise<void> {
		const generation = ++activation;
		activeProvider = adapterFor(ctx.model?.provider)?.provider;
		snapshot = undefined;
		render();
		const adapter = adapterFor(activeProvider);
		if (!adapter || blocked.has(adapter.provider)) {
			clearWidget(ctx);
			return;
		}
		let supported = false;
		try {
			supported = await adapter.supports(ctx);
		} catch {
			lastErrors.set(adapter.provider, "Could not check provider authentication");
		}
		if (generation !== activation || stopping) return;
		if (!supported) {
			clearWidget(ctx);
			return;
		}
		installWidget(ctx);
		const cached = await readCachedSnapshot(cachePath, adapter.provider);
		if (generation !== activation || stopping) return;
		if (cached && cached.measuredAt >= snapshotMeasuredAt()) snapshot = cached;
		render();
		if (isStale(Date.now())) await refresh(ctx);
	}

	async function performRefresh(adapter: UsageAdapter, ctx: ExtensionContext): Promise<RefreshResult> {
		const provider = adapter.provider;
		const signal = abortController?.signal ?? new AbortController().signal;
		try {
			if (!await adapter.supports(ctx)) {
				if (activeProvider === provider) clearWidget(ctx);
				return "unsupported";
			}
			const next = await adapter.fetch(ctx, signal);
			failures.set(provider, 0);
			retryAfter.delete(provider);
			lastErrors.delete(provider);
			if (activeProvider === provider && !stopping && next.measuredAt >= snapshotMeasuredAt()) {
				snapshot = next;
				render();
			}
			try {
				await writeCachedSnapshot(cachePath, next);
			} catch {
				lastErrors.set(provider, "Could not write usage cache");
			}
			return "updated";
		} catch (error) {
			if (stopping || signal.aborted) return "unchanged";
			const count = (failures.get(provider) ?? 0) + 1;
			failures.set(provider, count);
			retryAfter.set(provider, Date.now() + Math.min(300, 60 * 2 ** (count - 1)) * 1_000);
			if (error instanceof ProviderError && (error.code === "auth" || error.code === "entitlement")) {
				blocked.add(provider);
				lastErrors.set(provider, error.message);
				if (activeProvider === provider) clearWidget(ctx);
				return "blocked";
			}
			lastErrors.set(provider, error instanceof ProviderError ? error.message : "Usage refresh failed");
			return "failed";
		}
	}

	function refresh(ctx: ExtensionContext, force = false): Promise<RefreshResult> {
		if (ctx.mode !== "tui" || stopping) return Promise.resolve("unchanged");
		const adapter = adapterFor(ctx.model?.provider);
		if (!adapter) {
			clearWidget(ctx);
			return Promise.resolve("unsupported");
		}
		if (blocked.has(adapter.provider)) return Promise.resolve("blocked");
		if (!force && (!isStale(Date.now()) || Date.now() < (retryAfter.get(adapter.provider) ?? 0))) {
			return Promise.resolve("unchanged");
		}
		const existing = inFlight.get(adapter.provider);
		if (existing) return existing;
		const pending = performRefresh(adapter, ctx).finally(() => inFlight.delete(adapter.provider));
		inFlight.set(adapter.provider, pending);
		return pending;
	}

	function statusText(ctx: ExtensionContext): string {
		const provider = ctx.model?.provider;
		const adapter = adapterFor(provider);
		if (!provider || !adapter) return `sub-meter: ${provider ?? "no model"} is unsupported`;
		const oauth = provider === "openai-codex" && ctx.model && ctx.modelRegistry.isUsingOAuth(ctx.model);
		const lines = [`sub-meter: ${provider} (${oauth ? "ChatGPT OAuth" : "API key"})`];
		if (blocked.has(adapter.provider)) lines.push("Authentication or subscription check failed for this session; the widget is hidden.");
		if (!snapshot || snapshot.provider !== adapter.provider || snapshot.windows.length === 0) {
			lines.push("No usage windows available.");
		} else {
			for (const window of snapshot.windows) {
				const reset = formatReset(window.resetsAt, Date.now());
				lines.push(`${windowLabel(window.kind)}: ${formatPercent(window.percentUsed)}${reset ? `, resets in ${reset}` : ""}`);
			}
			lines.push(`Last update: ${new Date(snapshot.measuredAt).toLocaleString()}`);
			if (snapshot.limited) lines.push("Provider reports the usage limit is reached.");
		}
		const error = lastErrors.get(adapter.provider);
		if (error) lines.push(`Last error: ${error}`);
		return lines.join("\n");
	}

	async function setDisplay(mode: DisplayMode, ctx: ExtensionCommandContext): Promise<void> {
		settings = { ...settings, display: mode };
		await saveSettings(settingsPath, settings);
		rotationIndex = 0;
		render();
		ctx.ui.notify(`sub-meter display: ${mode}`, "info");
	}

	pi.registerCommand("sub-meter", {
		description: "Show, configure, or refresh subscription usage windows",
		getArgumentCompletions: (prefix) => completionValues
			.filter((value) => value.startsWith(prefix.trimStart()))
			.map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase();
			if (command === "rotate" || command === "both" || command === "session" || command === "week") {
				await setDisplay(command, ctx);
				return;
			}
			if (command === "refresh") {
				const result = await refresh(ctx, true);
				const messages: Record<RefreshResult, string> = {
					updated: "sub-meter usage updated",
					unchanged: "sub-meter refresh is unavailable outside interactive mode",
					unsupported: "sub-meter: active provider or auth is unsupported",
					blocked: lastErrors.get(adapterFor(ctx.model?.provider)?.provider ?? "openai-codex") ?? "sub-meter is hidden for this session",
					failed: lastErrors.get(adapterFor(ctx.model?.provider)?.provider ?? "openai-codex") ?? "sub-meter refresh failed",
				};
				ctx.ui.notify(messages[result], result === "updated" ? "info" : result === "unchanged" ? "info" : "warning");
				return;
			}
			if (command === "" || command === "status") {
				if (ctx.hasUI) ctx.ui.notify(statusText(ctx), "info");
				return;
			}
			ctx.ui.notify("Usage: /sub-meter [status|refresh|rotate|both|session|week]", "warning");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		stopping = false;
		if (timer) clearInterval(timer);
		timer = undefined;
		abortController?.abort();
		blocked.clear();
		failures.clear();
		retryAfter.clear();
		lastErrors.clear();
		sessionContext = ctx;
		settingsPath = join(getAgentDir(), "sub-meter", "settings.json");
		cachePath = join(getAgentDir(), "sub-meter", "cache.json");
		abortController = new AbortController();
		settings = await loadSettings(settingsPath);
		if (stopping) return;
		if (ctx.mode === "tui") {
			timer = setInterval(() => {
				if (stopping || !sessionContext) return;
				rotationIndex++;
				const provider = activeProvider;
				if (provider) {
					void readCachedSnapshot(cachePath, provider).then((cached) => {
						if (!stopping && activeProvider === provider && cached && cached.measuredAt > snapshotMeasuredAt()) snapshot = cached;
					}).finally(render);
				} else {
					render();
				}
			}, settings.rotateSeconds * 1_000);
		}
		await activate(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		sessionContext = ctx;
		await activate(ctx);
	});

	pi.on("after_provider_response", async (event, ctx) => {
		if (ctx.mode !== "tui" || ctx.model?.provider !== "openai-codex" || !ctx.modelRegistry.isUsingOAuth(ctx.model)) return;
		const adapter = adapterFor("openai-codex");
		const windows = adapter?.fromHeaders?.(event.headers, event.status);
		if (!adapter || !windows) return;
		const next: UsageSnapshot = { provider: adapter.provider, windows, measuredAt: Date.now(), ...(event.status === 429 ? { limited: true } : {}) };
		if (activeProvider === adapter.provider && !stopping && next.measuredAt >= snapshotMeasuredAt()) {
			snapshot = next;
			lastErrors.delete(adapter.provider);
			render();
		}
		try {
			await writeCachedSnapshot(cachePath, next);
		} catch {
			lastErrors.set(adapter.provider, "Could not write usage cache");
		}
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (isStale(Date.now())) await refresh(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stopping = true;
		activation++;
		if (timer) clearInterval(timer);
		timer = undefined;
		abortController?.abort();
		abortController = undefined;
		sessionContext = undefined;
		if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
		invalidateWidget = undefined;
		requestRender = undefined;
	});
}
