import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readCachedSnapshot, validateCache, writeCachedSnapshot } from "../src/cache.ts";
import type { UsageSnapshot } from "../src/types.ts";

const snapshot: UsageSnapshot = {
	provider: "openai-codex",
	windows: [{ kind: "session", percentUsed: 58, resetsAt: 123_000 }],
	measuredAt: 100_000,
};

test("cache validation rejects malformed data and clamps percentages", () => {
	assert.deepEqual(validateCache(null), {});
	assert.deepEqual(validateCache({ "openai-codex": { windows: [{}], measuredAt: 1 } }), {});
	const valid = validateCache({ "opencode-go": { windows: [{ kind: "week", percentUsed: 120 }], measuredAt: 1 } });
	assert.equal(valid["opencode-go"]?.windows[0].percentUsed, 100);
});

test("cache round trip stores usage only", async () => {
	const directory = await mkdtemp(join(tmpdir(), "sub-meter-cache-"));
	const path = join(directory, "cache.json");
	assert.equal(await readCachedSnapshot(path, snapshot.provider), undefined);
	await writeCachedSnapshot(path, snapshot);
	assert.deepEqual(await readCachedSnapshot(path, snapshot.provider), snapshot);
	const raw = await readFile(path, "utf8");
	assert.ok(!raw.includes("provider"));
	assert.deepEqual(await readdir(directory), ["cache.json"]);
});

test("newest measured snapshot wins and other providers survive", async () => {
	const directory = await mkdtemp(join(tmpdir(), "sub-meter-cache-"));
	const path = join(directory, "cache.json");
	await writeCachedSnapshot(path, snapshot);
	await writeCachedSnapshot(path, { ...snapshot, measuredAt: 90_000, windows: [] });
	assert.deepEqual(await readCachedSnapshot(path, snapshot.provider), snapshot);
	const go: UsageSnapshot = { provider: "opencode-go", windows: [{ kind: "week", percentUsed: 31 }], measuredAt: 200_000 };
	await writeCachedSnapshot(path, go);
	assert.deepEqual(await readCachedSnapshot(path, go.provider), go);
	assert.deepEqual(await readCachedSnapshot(path, snapshot.provider), snapshot);
});

test("concurrent writers preserve providers and the newest snapshot", async () => {
	const directory = await mkdtemp(join(tmpdir(), "sub-meter-cache-"));
	const path = join(directory, "cache.json");
	const newest = { ...snapshot, measuredAt: 300_000, windows: [{ kind: "session" as const, percentUsed: 75 }] };
	const go: UsageSnapshot = { provider: "opencode-go", windows: [{ kind: "week", percentUsed: 31 }], measuredAt: 200_000 };
	await Promise.all([
		writeCachedSnapshot(path, snapshot),
		writeCachedSnapshot(path, newest),
		writeCachedSnapshot(path, go),
		writeCachedSnapshot(path, { ...snapshot, measuredAt: 50_000 }),
	]);
	assert.deepEqual(await readCachedSnapshot(path, snapshot.provider), newest);
	assert.deepEqual(await readCachedSnapshot(path, go.provider), go);
	assert.deepEqual(await readdir(directory), ["cache.json"]);
});
