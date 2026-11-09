export const DEFAULT_HISTORY_SIZE = 20;

export interface RequestSample {
	model: string;
	e2eMs: number;
	ttftMs?: number;
	tokensPerSecond?: number;
	outputTokens: number;
}

export interface RequestMeasurement {
	model: string;
	e2eMs: number;
	ttftMs?: number;
	outputTokens: number;
}

export interface MetricsSummary {
	requestCount: number;
	speedSampleCount: number;
	ttftP50Ms?: number;
	ttftP95Ms?: number;
	e2eP50Ms?: number;
	e2eP95Ms?: number;
	tokensPerSecondP50?: number;
	tokensPerSecondP95?: number;
}

function finiteNonNegative(value: number | undefined): value is number {
	return value !== undefined && Number.isFinite(value) && value >= 0;
}

export function measureRequest(measurement: RequestMeasurement): RequestSample | undefined {
	if (!finiteNonNegative(measurement.e2eMs)) return undefined;
	const outputTokens = finiteNonNegative(measurement.outputTokens) ? measurement.outputTokens : 0;
	const decodeMs = finiteNonNegative(measurement.ttftMs) ? measurement.e2eMs - measurement.ttftMs : undefined;
	const tokensPerSecond =
		outputTokens > 1 && decodeMs !== undefined && decodeMs > 0
			? ((outputTokens - 1) * 1000) / decodeMs
			: undefined;
	return {
		model: measurement.model,
		e2eMs: measurement.e2eMs,
		ttftMs: measurement.ttftMs,
		tokensPerSecond,
		outputTokens,
	};
}

export function percentile(values: number[], fraction: number): number | undefined {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (sorted.length === 0) return undefined;
	const position = Math.min(1, Math.max(0, fraction)) * (sorted.length - 1);
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function summarize(samples: RequestSample[]): MetricsSummary {
	const ttfts = samples.flatMap((sample) => (finiteNonNegative(sample.ttftMs) ? [sample.ttftMs] : []));
	const durations = samples.map((sample) => sample.e2eMs).filter(finiteNonNegative);
	const speeds = samples.flatMap((sample) =>
		sample.tokensPerSecond !== undefined && Number.isFinite(sample.tokensPerSecond) && sample.tokensPerSecond >= 0
			? [sample.tokensPerSecond]
			: [],
	);
	return {
		requestCount: samples.length,
		speedSampleCount: speeds.length,
		ttftP50Ms: percentile(ttfts, 0.5),
		ttftP95Ms: percentile(ttfts, 0.95),
		e2eP50Ms: percentile(durations, 0.5),
		e2eP95Ms: percentile(durations, 0.95),
		tokensPerSecondP50: percentile(speeds, 0.5),
		tokensPerSecondP95: percentile(speeds, 0.95),
	};
}

export function appendSample(
	samples: RequestSample[],
	sample: RequestSample,
	limit = DEFAULT_HISTORY_SIZE,
): RequestSample[] {
	return [...samples, sample].slice(-Math.max(1, Math.floor(limit)));
}
