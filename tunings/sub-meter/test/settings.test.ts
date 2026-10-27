import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, validateSettings } from "../src/settings.ts";

test("defaults and invalid values match upstream behavior", () => {
	assert.deepEqual(validateSettings(undefined), DEFAULT_SETTINGS);
	assert.deepEqual(validateSettings(null), DEFAULT_SETTINGS);
	assert.equal(validateSettings({ display: "unknown" }).display, "rotate");
	assert.equal(validateSettings({ rotateSeconds: 0 }).rotateSeconds, 8);
	assert.equal(validateSettings({ rotateSeconds: -2 }).rotateSeconds, 8);
	assert.equal(validateSettings({ refreshSeconds: 1 }).refreshSeconds, 30);
	assert.equal(validateSettings({ refreshSeconds: Number.NaN }).refreshSeconds, 60);
	assert.equal(validateSettings({ display: "both", rotateSeconds: 2, refreshSeconds: 45, warnAt: 70, dangerAt: 95 }).display, "both");
});

test("settings load, persist, and recover from malformed files", async () => {
	const directory = await mkdtemp(join(tmpdir(), "sub-meter-settings-"));
	const path = join(directory, "nested", "settings.json");
	assert.deepEqual(await loadSettings(path), DEFAULT_SETTINGS);
	await saveSettings(path, { ...DEFAULT_SETTINGS, display: "both", refreshSeconds: 30 });
	assert.deepEqual((await loadSettings(path)).display, "both");
	assert.equal(JSON.parse(await readFile(path, "utf8")).refreshSeconds, 30);
	await saveSettings(path, { ...DEFAULT_SETTINGS, display: "week" });
	await import("node:fs/promises").then(({ writeFile }) => writeFile(path, "not json"));
	assert.deepEqual(await loadSettings(path), DEFAULT_SETTINGS);
});
