import assert from "node:assert/strict";
import test from "node:test";
import { selectWindows } from "../src/select.ts";
import type { UsageWindow } from "../src/types.ts";

const session: UsageWindow = { kind: "session", percentUsed: 10 };
const week: UsageWindow = { kind: "week", percentUsed: 20 };
const month: UsageWindow = { kind: "month", percentUsed: 30 };

test("specific modes fall back to an available window", () => {
	assert.deepEqual(selectWindows([week], "session"), [week]);
	assert.deepEqual(selectWindows([session], "week"), [session]);
	assert.deepEqual(selectWindows([month], "week"), [month]);
	assert.deepEqual(selectWindows([], "session"), []);
});

test("rotation cycles through every window in stable order", () => {
	const windows = [month, week, session];
	assert.deepEqual(selectWindows(windows, "rotate", 0), [session]);
	assert.deepEqual(selectWindows(windows, "rotate", 1), [week]);
	assert.deepEqual(selectWindows(windows, "rotate", 2), [month]);
	assert.deepEqual(selectWindows(windows, "rotate", 3), [session]);
});

test("both shows all available windows without inventing missing ones", () => {
	assert.deepEqual(selectWindows([week, session], "both"), [session, week]);
	assert.deepEqual(selectWindows([week], "both"), [week]);
});
