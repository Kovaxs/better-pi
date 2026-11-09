import assert from "node:assert/strict";
import test from "node:test";
import { formatCompactStatus, formatDuration, formatFullStatus, formatStatus } from "../src/format.ts";
import { summarize, type MetricsSummary } from "../src/metrics.ts";

const summary: MetricsSummary = {
	requestCount: 4,
	speedSampleCount: 3,
	ttftP50Ms: 420,
	e2eP50Ms: 2100,
	tokensPerSecondP50: 47.25,
};

test("duration formatting stays compact across time scales", () => {
	assert.equal(formatDuration(undefined), "—");
	assert.equal(formatDuration(420), "420ms");
	assert.equal(formatDuration(18_400), "18.4s");
	assert.equal(formatDuration(60_000), "1m");
	assert.equal(formatDuration(65_200), "1m 5s");
});

test("full status includes task and all model-call metrics", () => {
	assert.equal(
		formatFullStatus({ summary, taskMs: 18_400 }),
		"task 18.4s ttft 420ms call 2.1s 47.3 tok/s p50",
	);
});

test("narrow status retains only task time and median generation speed", () => {
	const snapshot = { summary, taskMs: 18_400 };
	assert.equal(formatCompactStatus(snapshot), "task 18.4s 47.3 tok/s p50");
	assert.equal(formatStatus(snapshot, 100), formatFullStatus(snapshot));
	assert.equal(formatStatus(snapshot, 40), formatCompactStatus(snapshot));
});

test("missing measurements render as unavailable", () => {
	assert.equal(formatCompactStatus({ summary: summarize([]) }), "task — — tok/s p50");
});
