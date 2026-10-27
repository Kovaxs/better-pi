import { clampPercent } from "../format.ts";
import { ProviderError, type UsageAdapter, type UsageSnapshot, type UsageWindow, type WindowKind } from "../types.ts";

export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const DAY_SECONDS = 86_400;
const WEEK_SECONDS = 8 * DAY_SECONDS;

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numeric(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function codexWindowKind(windowSeconds: number): WindowKind | undefined {
	if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return undefined;
	if (windowSeconds <= DAY_SECONDS) return "session";
	if (windowSeconds <= WEEK_SECONDS) return "week";
	return "month";
}

function resetEpoch(value: number | undefined): number | undefined {
	if (value === undefined || value <= 0) return undefined;
	return value < 1_000_000_000_000 ? value * 1_000 : value;
}

function headerWindow(headers: Record<string, string>, prefix: "primary" | "secondary", now: number): UsageWindow | undefined {
	const percent = numeric(headers[`x-codex-${prefix}-used-percent`]);
	const minutes = numeric(headers[`x-codex-${prefix}-window-minutes`]);
	if (percent === undefined || minutes === undefined) return undefined;
	const kind = codexWindowKind(minutes * 60);
	if (!kind) return undefined;
	const resetAt = resetEpoch(numeric(headers[`x-codex-${prefix}-reset-at`]));
	const resetAfter = numeric(headers[`x-codex-${prefix}-reset-after-seconds`]);
	const resetsAt = resetAt ?? (resetAfter !== undefined && resetAfter >= 0 ? now + resetAfter * 1_000 : undefined);
	return { kind, percentUsed: clampPercent(percent), ...(resetsAt === undefined ? {} : { resetsAt }) };
}

export function parseCodexHeaders(input: Record<string, string>, now = Date.now()): UsageWindow[] | undefined {
	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(input)) headers[key.toLowerCase()] = value;
	const windows = [headerWindow(headers, "primary", now), headerWindow(headers, "secondary", now)].filter((window) => window !== undefined);
	return windows.length > 0 ? windows : undefined;
}

function whamWindow(value: unknown, now: number): UsageWindow | undefined {
	const input = record(value);
	if (!input) return undefined;
	const percent = finite(input.used_percent);
	const seconds = finite(input.limit_window_seconds);
	if (percent === undefined || seconds === undefined) return undefined;
	const kind = codexWindowKind(seconds);
	if (!kind) return undefined;
	const resetsAt = resetEpoch(finite(input.reset_at)) ?? (() => {
		const resetAfter = finite(input.reset_after_seconds);
		return resetAfter !== undefined && resetAfter >= 0 ? now + resetAfter * 1_000 : undefined;
	})();
	return { kind, percentUsed: clampPercent(percent), ...(resetsAt === undefined ? {} : { resetsAt }) };
}

export function parseCodexUsage(value: unknown, now = Date.now()): UsageSnapshot | undefined {
	const rateLimit = record(record(value)?.rate_limit);
	if (!rateLimit) return undefined;
	const windows = [whamWindow(rateLimit.primary_window, now), whamWindow(rateLimit.secondary_window, now)].filter((window) => window !== undefined);
	if (windows.length === 0) return undefined;
	return {
		provider: "openai-codex",
		windows,
		measuredAt: now,
		...(rateLimit.limit_reached === true ? { limited: true } : {}),
	};
}

export function codexAccountId(token: string): string | undefined {
	try {
		const payload = token.split(".")[1];
		if (!payload) return undefined;
		const claims = record(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
		const auth = record(claims?.["https://api.openai.com/auth"]);
		return typeof auth?.chatgpt_account_id === "string" && auth.chatgpt_account_id.length > 0
			? auth.chatgpt_account_id
			: undefined;
	} catch {
		return undefined;
	}
}

export const codexAdapter: UsageAdapter = {
	provider: "openai-codex",
	async supports(ctx) {
		return ctx.model?.provider === "openai-codex" && ctx.modelRegistry.isUsingOAuth(ctx.model);
	},
	fromHeaders(headers, _status, now) {
		return parseCodexHeaders(headers, now);
	},
	async fetch(ctx, signal) {
		const token = await ctx.modelRegistry.getApiKeyForProvider("openai-codex");
		const accountId = token ? codexAccountId(token) : undefined;
		if (!token || !accountId) throw new ProviderError("ChatGPT OAuth credentials or account id are unavailable", "auth");
		let response: Response;
		try {
			response = await fetch(CODEX_USAGE_URL, {
				headers: { Authorization: `Bearer ${token}`, "ChatGPT-Account-Id": accountId, Accept: "application/json" },
				redirect: "error",
				signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
			});
		} catch (error) {
			throw new ProviderError("ChatGPT usage request failed", "network", undefined, error);
		}
		if (!response.ok) {
			throw new ProviderError(`ChatGPT usage returned HTTP ${response.status}`, response.status === 401 ? "auth" : "http", response.status);
		}
		let body: unknown;
		try {
			body = await response.json();
		} catch (error) {
			throw new ProviderError("ChatGPT usage returned invalid JSON", "invalid", undefined, error);
		}
		const snapshot = parseCodexUsage(body);
		if (!snapshot) throw new ProviderError("ChatGPT usage response had no valid windows", "invalid");
		return snapshot;
	},
};
