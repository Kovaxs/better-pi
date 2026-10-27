import { clampPercent } from "../format.ts";
import { ProviderError, type UsageAdapter, type UsageSnapshot, type UsageWindow, type WindowKind } from "../types.ts";

export const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resetTime(input: Record<string, unknown>, now: number): number | undefined {
	const resetIn = finite(input.resetInSec);
	if (resetIn !== undefined) return resetIn >= 0 ? now + resetIn * 1_000 : undefined;
	const reset = input.resetsAt;
	if (typeof reset === "string") {
		const parsed = Date.parse(reset);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	const epoch = finite(reset);
	if (epoch === undefined || epoch <= 0) return undefined;
	return epoch < 1_000_000_000_000 ? epoch * 1_000 : epoch;
}

function goWindow(value: unknown, kind: WindowKind, now: number): UsageWindow | undefined {
	const input = record(value);
	if (!input) return undefined;
	const percent = finite(input.percent) ?? finite(input.usagePercent);
	if (percent === undefined) return undefined;
	const resetsAt = resetTime(input, now);
	return { kind, percentUsed: clampPercent(percent), ...(resetsAt === undefined ? {} : { resetsAt }) };
}

export function parseOpenCodeGoUsage(value: unknown, now = Date.now()): UsageSnapshot | undefined {
	const usage = record(record(value)?.usage);
	if (!usage) return undefined;
	const windows = [
		goWindow(usage.rolling, "session", now),
		goWindow(usage.weekly, "week", now),
		goWindow(usage.monthly, "month", now),
	].filter((window) => window !== undefined);
	if (windows.length === 0) return undefined;
	const statuses = [usage.rolling, usage.weekly, usage.monthly]
		.map(record)
		.map((window) => typeof window?.status === "string" ? window.status.toLowerCase() : undefined);
	const limited = statuses.some((status) => status === "limited" || status === "limit_reached" || status === "exceeded");
	return { provider: "opencode-go", windows, measuredAt: now, ...(limited ? { limited: true } : {}) };
}

export const openCodeGoAdapter: UsageAdapter = {
	provider: "opencode-go",
	async supports(ctx) {
		return ctx.model?.provider === "opencode-go" && await ctx.modelRegistry.getApiKeyForProvider("opencode-go") !== undefined;
	},
	async fetch(ctx, signal) {
		const token = await ctx.modelRegistry.getApiKeyForProvider("opencode-go");
		if (!token) throw new ProviderError("OpenCode Go API key is unavailable", "auth");
		let response: Response;
		try {
			response = await fetch(OPENCODE_GO_USAGE_URL, {
				headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
				redirect: "error",
				signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
			});
		} catch (error) {
			throw new ProviderError("OpenCode Go usage request failed", "network", undefined, error);
		}
		if (response.status === 401) throw new ProviderError("OpenCode Go rejected the API key; regenerate it and try again", "auth", 401);
		if (response.status === 403) {
			const body = await response.text().catch(() => "");
			if (body.includes("EntitlementError")) {
				throw new ProviderError("No active OpenCode Go subscription was found; regenerate the key if your subscription is active", "entitlement", 403);
			}
		}
		if (!response.ok) throw new ProviderError(`OpenCode Go usage returned HTTP ${response.status}`, "http", response.status);
		let body: unknown;
		try {
			body = await response.json();
		} catch (error) {
			throw new ProviderError("OpenCode Go usage returned invalid JSON", "invalid", undefined, error);
		}
		const snapshot = parseOpenCodeGoUsage(body);
		if (!snapshot) throw new ProviderError("OpenCode Go usage response had no valid windows", "invalid");
		return snapshot;
	},
};
