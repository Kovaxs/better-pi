export type WindowKind = "session" | "week" | "month";
export type ProviderId = "openai-codex" | "opencode-go";
export type DisplayMode = "rotate" | "both" | "session" | "week";

export interface UsageWindow {
	kind: WindowKind;
	percentUsed: number;
	resetsAt?: number;
}

export interface UsageSnapshot {
	provider: ProviderId;
	windows: UsageWindow[];
	measuredAt: number;
	limited?: boolean;
}

export interface Settings {
	display: DisplayMode;
	rotateSeconds: number;
	refreshSeconds: number;
	warnAt: number;
	dangerAt: number;
}

export interface ProviderContext {
	model?: { provider: string };
	modelRegistry: {
		getApiKeyForProvider(provider: string): Promise<string | undefined>;
		isUsingOAuth(model: { provider: string }): boolean;
	};
}

export interface UsageAdapter {
	provider: ProviderId;
	supports(ctx: ProviderContext): Promise<boolean>;
	fromHeaders?(headers: Record<string, string>, status: number, now?: number): UsageWindow[] | undefined;
	fetch(ctx: ProviderContext, signal: AbortSignal): Promise<UsageSnapshot>;
}

export class ProviderError extends Error {
	readonly code: "auth" | "entitlement" | "http" | "invalid" | "network";
	readonly status?: number;
	override readonly cause?: unknown;

	constructor(
		message: string,
		code: "auth" | "entitlement" | "http" | "invalid" | "network",
		status?: number,
		cause?: unknown,
	) {
		super(message);
		this.name = "ProviderError";
		this.code = code;
		this.status = status;
		this.cause = cause;
	}
}
