import type { Settings, UsageWindow, WindowKind } from "./types.ts";

export const BAR_CELLS = 10;

export function clampPercent(percent: number): number {
	return Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
}

export function formatBar(percent: number): string {
	const filled = Math.round(clampPercent(percent) / BAR_CELLS);
	return "━".repeat(filled) + "─".repeat(BAR_CELLS - filled);
}

export function formatPercent(percent: number): string {
	return `${Math.round(clampPercent(percent))}%`;
}

export function colorLevel(percent: number, settings: Pick<Settings, "warnAt" | "dangerAt">): "normal" | "warning" | "error" {
	if (percent >= settings.dangerAt) return "error";
	if (percent >= settings.warnAt) return "warning";
	return "normal";
}

export function formatReset(resetsAt: number | undefined, now: number): string | undefined {
	if (resetsAt === undefined || !Number.isFinite(resetsAt) || resetsAt <= now) return undefined;
	const totalMinutes = Math.ceil((resetsAt - now) / 60_000);
	const days = Math.floor(totalMinutes / 1_440);
	const hours = Math.floor((totalMinutes % 1_440) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
	if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
	return `${Math.max(1, minutes)}m`;
}

export function windowLabel(kind: WindowKind): string {
	return kind === "session" ? "5h" : kind;
}

export function currentWindow(window: UsageWindow, now: number): UsageWindow {
	if (window.resetsAt !== undefined && window.resetsAt <= now) {
		return { kind: window.kind, percentUsed: 0 };
	}
	return window;
}

type Style = (text: string, level: ReturnType<typeof colorLevel>) => string;

export interface FormatOptions {
	style?: Style;
	visibleWidth?: (text: string) => number;
	truncateToWidth?: (text: string, width: number) => string;
}

function renderWindow(window: UsageWindow, now: number, settings: Settings, bars: boolean, resets: boolean, style: Style): string {
	const current = currentWindow(window, now);
	const bar = bars ? `${formatBar(current.percentUsed)} ` : "";
	const reset = resets ? formatReset(current.resetsAt, now) : undefined;
	const text = `${windowLabel(current.kind)} ${bar}${formatPercent(current.percentUsed)}${reset ? ` ↻ ${reset}` : ""}`;
	return style(text, colorLevel(current.percentUsed, settings));
}

export function formatUsageLine(
	windows: UsageWindow[],
	width: number,
	settings: Settings,
	now: number,
	options: FormatOptions = {},
): string | undefined {
	if (windows.length === 0 || width <= 0) return undefined;
	const style = options.style ?? ((text: string) => text);
	const measure = options.visibleWidth ?? ((text: string) => text.length);
	const truncate = options.truncateToWidth ?? ((text: string) => text);
	for (const [bars, resets] of [[true, true], [false, true], [false, false]] as const) {
		const text = windows.map((window) => renderWindow(window, now, settings, bars, resets, style)).join("  |  ");
		if (measure(text) <= width) {
			const padding = " ".repeat(width - measure(text));
			return truncate(`${padding}${text}`, width);
		}
	}
	return undefined;
}
