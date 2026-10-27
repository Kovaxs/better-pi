import type { DisplayMode, UsageWindow, WindowKind } from "./types.ts";

const order: WindowKind[] = ["session", "week", "month"];

function ordered(windows: UsageWindow[]): UsageWindow[] {
	return order.flatMap((kind) => windows.filter((window) => window.kind === kind));
}

export function selectWindows(windows: UsageWindow[], display: DisplayMode, rotationIndex = 0): UsageWindow[] {
	const available = ordered(windows);
	if (available.length === 0) return [];
	if (display === "both") return available;
	if (display === "rotate") return [available[Math.abs(Math.trunc(rotationIndex)) % available.length]];
	return [available.find((window) => window.kind === display) ?? available[0]];
}
