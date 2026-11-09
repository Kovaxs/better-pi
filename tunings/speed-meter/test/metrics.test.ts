import assert from "node:assert/strict";
import test from "node:test";
import { appendSample, measureRequest, percentile, summarize, type RequestSample } from "../src/metrics.ts";

test("generation speed excludes time to first token", () => {
	const sample = measureRequest({ model: "provider/model", e2eMs: 2400, ttftMs: 400, outputTokens: 101 });
	assert.equal(sample?.tokensPerSecond, 50);
	assert.equal(sample?.outputTokens, 101);
});

test("invalid or degenerate responses do not invent speed samples", () => {
	assert.equal(measureRequest({ model: "p/m", e2eMs: -1, outputTokens: 10 }), undefined);
	assert.equal(measureRequest({ model: "p/m", e2eMs: 100, outputTokens: 1, ttftMs: 20 })?.tokensPerSecond, undefined);
	assert.equal(measureRequest({ model: "p/m", e2eMs: 100, outputTokens: 10 })?.tokensPerSecond, undefined);
	assert.equal(measureRequest({ model: "p/m", e2eMs: 100, outputTokens: 10, ttftMs: 100 })?.tokensPerSecond, undefined);
});

test("percentiles interpolate and ignore non-finite values", () => {
	assert.equal(percentile([], 0.5), undefined);
	assert.equal(percentile([100, 200, 300, 400], 0.5), 250);
	assert.equal(percentile([100, 200, 300, 400], 0.95), 385);
	assert.equal(percentile([100, Number.NaN, 300], 0.5), 200);
});

test("summary calculates independent model and generation distributions", () => {
	const samples = [
		measureRequest({ model: "p/m", e2eMs: 1000, ttftMs: 100, outputTokens: 46 }),
		measureRequest({ model: "p/m", e2eMs: 2000, ttftMs: 300, outputTokens: 35 }),
		measureRequest({ model: "p/m", e2eMs: 3000, outputTokens: 0 }),
	] as RequestSample[];
	const summary = summarize(samples);
	assert.equal(summary.requestCount, 3);
	assert.equal(summary.speedSampleCount, 2);
	assert.equal(summary.ttftP50Ms, 200);
	assert.equal(summary.e2eP50Ms, 2000);
	assert.equal(summary.tokensPerSecondP50, (50 + 20) / 2);
	assert.ok(summary.tokensPerSecondP95 && summary.tokensPerSecondP95 > summary.tokensPerSecondP50);
});

test("history retains the newest bounded sample window", () => {
	let samples: RequestSample[] = [];
	for (let i = 0; i < 25; i++) {
		samples = appendSample(samples, { model: "p/m", e2eMs: i, outputTokens: 0 }, 20);
	}
	assert.equal(samples.length, 20);
	assert.equal(samples[0].e2eMs, 5);
	assert.equal(samples.at(-1)?.e2eMs, 24);
});
