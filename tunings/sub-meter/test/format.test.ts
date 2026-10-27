import assert from "node:assert/strict";
import test from "node:test";
import { clampPercent, colorLevel, formatBar, formatPercent, formatReset, formatUsageLine } from "../src/format.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";
import type { UsageWindow } from "../src/types.ts";

const now = Date.UTC(2026, 0, 1);
const settings = { ...DEFAULT_SETTINGS };
const session: UsageWindow = { kind: "session", percentUsed: 58, resetsAt: now + 130 * 60_000 };

test("bars clamp and round to ten cells", () => {
	assert.equal(formatBar(58), "━━━━━━────");
	assert.equal(formatBar(55), "━━━━━━────");
	assert.equal(formatBar(54), "━━━━━─────");
	assert.equal(formatBar(-10), "──────────");
	assert.equal(formatBar(150), "━━━━━━━━━━");
	assert.equal(clampPercent(Number.NaN), 0);
	assert.equal(formatPercent(58.6), "59%");
});

test("color thresholds match warning and danger settings", () => {
	assert.equal(colorLevel(74.9, settings), "normal");
	assert.equal(colorLevel(75, settings), "warning");
	assert.equal(colorLevel(89.9, settings), "warning");
	assert.equal(colorLevel(90, settings), "error");
});

test("reset text rounds up and omits zero units", () => {
	assert.equal(formatReset(now + 42 * 60_000, now), "42m");
	assert.equal(formatReset(now + 1, now), "1m");
	assert.equal(formatReset(now + 3 * 3_600_000 + 5 * 60_000, now), "3h 5m");
	assert.equal(formatReset(now + 3 * 3_600_000, now), "3h");
	assert.equal(formatReset(now + 2 * 86_400_000 + 4 * 3_600_000, now), "2d 4h");
	assert.equal(formatReset(now, now), undefined);
	assert.equal(formatReset(undefined, now), undefined);
});

test("full line is right aligned", () => {
	assert.equal(formatUsageLine([session], 60, settings, now), "5h ━━━━━━──── 58% ↻ 2h 10m".padStart(60));
});

test("width fitting drops bars, then reset, then hides", () => {
	const full = "5h ━━━━━━──── 58% ↻ 2h 10m";
	const noBars = "5h 58% ↻ 2h 10m";
	const bare = "5h 58%";
	assert.equal(formatUsageLine([session], full.length - 1, settings, now), noBars.padStart(full.length - 1));
	assert.equal(formatUsageLine([session], noBars.length - 1, settings, now), bare.padStart(noBars.length - 1));
	assert.equal(formatUsageLine([session], bare.length - 1, settings, now), undefined);
});

test("expired windows show zero with no reset", () => {
	assert.equal(formatUsageLine([{ kind: "week", percentUsed: 91, resetsAt: now - 1 }], 20, settings, now), "week ────────── 0%".padStart(20));
});

test("both windows share one line", () => {
	const text = formatUsageLine([session, { kind: "week", percentUsed: 31 }], 100, settings, now);
	assert.ok(text?.includes("  |  week ━━━─────── 31%"));
});

test("ANSI styling uses injected visible width measurement", () => {
	const text = formatUsageLine([session], 40, settings, now, {
		style: (value) => `\u001b[31m${value}\u001b[0m`,
		visibleWidth: (value) => value.replace(/\u001b\[[0-9;]*m/g, "").length,
	});
	assert.equal(text?.replace(/\u001b\[[0-9;]*m/g, "").length, 40);
});
