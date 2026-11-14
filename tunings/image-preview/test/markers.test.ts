import assert from "node:assert/strict";
import { test } from "node:test";
import { ImageMarkers } from "../src/markers.ts";

test("clipboard paths become markers and expand losslessly before submission", () => {
	const markers = new ImageMarkers("/work", "/home/me");
	for (const [text, expected] of [
		["/tmp/pi-clipboard-123.png", "[Image #1]"],
		[" /tmp/Screen shot.png ", " [Image #2] "],
		['@"/tmp/another shot.jpg"', "[Image #3]"],
		["~/picture.webp", "[Image #4]"],
	]) {
		const collapsed = markers.collapse(text);
		assert.equal(collapsed, expected);
		assert.equal(markers.expand(collapsed), text);
	}
	assert.deepEqual(markers.source("[Image #2]"), { key: "/tmp/Screen shot.png", label: "/tmp/Screen shot.png", path: "/tmp/Screen shot.png" });
});

test("multiple file paths retain whitespace, stable numbers and undo/history references", () => {
	const markers = new ImageMarkers("/work");
	const original = "/tmp/a.png\n/tmp/b.jpg\n";
	const collapsed = markers.collapse(original);
	assert.equal(collapsed, "[Image #1]\n[Image #2]\n");
	assert.equal(markers.expand(collapsed), original);
	assert.equal(markers.collapse("/tmp/a.png"), "[Image #1]");
	assert.equal(markers.collapse("/tmp/c.png"), "[Image #3]");
	assert.equal(markers.expand("Undo restored [Image #1]"), "Undo restored /tmp/a.png");
	assert.equal(markers.numberForPath("/tmp/b.jpg"), 2);
	assert.equal(markers.sourcesIn("[Image #2] [Image #999]").length, 1);
	assert.equal(markers.collapse("look /tmp/a.png"), "look [Image #1]");
	assert.equal(markers.collapse("look /tmp/my screen.png"), "look [Image #4]");
	assert.equal(markers.expand("look [Image #4]"), "look /tmp/my screen.png");
	assert.equal(markers.expand("[Image #999]"), "[Image #999]");
});

test("normal text, network URLs and unsupported files are not hidden", () => {
	const markers = new ImageMarkers("/work");
	for (const text of ["what is wrong?", "https://example.com/a.png", "/tmp/a.svg", "![a](https://example.com/a.png)"]) {
		assert.equal(markers.collapse(text), text);
	}
});
