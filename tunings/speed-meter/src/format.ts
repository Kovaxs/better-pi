import type { MetricsSummary } from "./metrics.ts";

export interface StatusSnapshot {
	summary: MetricsSummary;
	taskMs?: number;
}

export function formatDuration(milliseconds: number | undefined): string {
	if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return "—";
	if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
	if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
	const minutes = Math.floor(milliseconds / 60_000);
	const seconds = Math.floor((milliseconds % 60_000) / 1000);
	return `${minutes}m${seconds > 0 ? ` ${seconds}s` : ""}`;
}

export function formatRate(tokensPerSecond: number | undefined): string {
	if (tokensPerSecond === undefined || !Number.isFinite(tokensPerSecond) || tokensPerSecond < 0) return "—";
	return tokensPerSecond >= 100 ? `${Math.round(tokensPerSecond)}` : tokensPerSecond.toFixed(1);
}

export function formatFullStatus(snapshot: StatusSnapshot): string {
	const { summary } = snapshot;
	return [
		`task ${formatDuration(snapshot.taskMs)}`,
		`ttft ${formatDuration(summary.ttftP50Ms)}`,
		`call ${formatDuration(summary.e2eP50Ms)}`,
		`${formatRate(summary.tokensPerSecondP50)} tok/s p50`,
	].join(" ");
}

export function formatCompactStatus(snapshot: StatusSnapshot): string {
	return `task ${formatDuration(snapshot.taskMs)} ${formatRate(snapshot.summary.tokensPerSecondP50)} tok/s p50`;
}

export function formatStatus(snapshot: StatusSnapshot, width: number): string {
	const full = formatFullStatus(snapshot);
	return full.length <= width ? full : formatCompactStatus(snapshot);
}
