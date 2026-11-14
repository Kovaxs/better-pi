import assert from "node:assert/strict";
import { test } from "node:test";
import { branchImages, chipLayout, imageMime, imagePaths, uniqueSources, viewerCommand } from "../src/images.ts";

test("finds pasted, quoted, escaped, @, relative, and home image paths", () => {
	assert.deepEqual(imagePaths('Look /tmp/a.png @./b.JPG "/tmp/screen shot.webp" /tmp/other\\ shot.png ~/c.gif', "/work", "/home/me"),
		["/tmp/a.png", "/work/b.JPG", "/tmp/screen shot.webp", "/tmp/other shot.png", "/home/me/c.gif"]);
	assert.deepEqual(imagePaths("@'/tmp/a b.png' @\"/tmp/c d.png\" ./one.png\n./two.png", "/work"),
		["/tmp/a b.png", "/tmp/c d.png", "/work/one.png", "/work/two.png"]);
	assert.deepEqual(imagePaths("look /tmp/unquoted screen shot.png and /tmp/second.jpg", "/work"), ["/tmp/unquoted screen shot.png", "/tmp/second.jpg"]);
});

test("ignores remote images, unsupported formats and deduplicates paths", () => {
	assert.deepEqual(imagePaths("https://example.com/a.png data:image/png;base64,xxx ./a.svg ./a.png ./a.png", "/work"), ["/work/a.png"]);
	assert.deepEqual(imagePaths("(/tmp/a.png),", "/work"), ["/tmp/a.png"]);
});

test("collects only user images from the supplied branch, not tool/assistant images", () => {
	const image = { type: "image", data: "AAAA", mimeType: "image/png" };
	const entries = [
		{ type: "message", id: "a", message: { role: "user", content: [{ type: "text", text: "/tmp/a.png" }, image] } },
		{ type: "message", id: "b", message: { role: "assistant", content: [image] } },
		{ type: "message", id: "c", message: { role: "user", content: "/tmp/a.png /tmp/b.jpg" } },
	];
	const sources = branchImages(entries, "/work");
	assert.deepEqual(sources.map((s) => s.key), ["/tmp/a.png", "a:1", "/tmp/b.jpg"]);
	assert.deepEqual(branchImages(entries.slice(0, 1), "/work").map((s) => s.key), ["/tmp/a.png", "a:1"]);
	assert.equal(uniqueSources([...sources, ...sources]).length, 3);
	assert.deepEqual(branchImages([{ type: "message", id: "bad", message: { role: "user", content: [null, 1] } }], "/work"), []);
});

test("chips never exceed the available columns, and hitboxes exclude gaps", () => {
	const result = chipLayout(15, 42, "Draft: ");
	assert.equal(result.text, "Draft: [Image #1] [Image #2] [Image #3]");
	assert.deepEqual(result.chips[0], { index: 0, start: 7, end: 17 });
	for (let width = 0; width < 160; width++) {
		const layout = chipLayout(20, width, "Draft: ");
		assert.ok(layout.text.length <= width);
		assert.ok(layout.chips.every((c) => c.end <= width));
	}
	assert.equal(chipLayout(1, 5, "").chips.length, 0);
});

test("sniffs supported formats, not filename extensions", () => {
	const png = Buffer.alloc(24);
	Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
	assert.equal(imageMime(png), "image/png");
	assert.equal(imageMime(Buffer.from([255,216,255])), "image/jpeg");
	assert.equal(imageMime(Buffer.from("GIF89a")), "image/gif");
	assert.equal(imageMime(Buffer.from("RIFFxxxxWEBP")), "image/webp");
	assert.equal(imageMime(Buffer.from("<svg></svg>")), undefined);
	assert.equal(imageMime(Buffer.alloc(0)), undefined);
});

test("viewer arguments are passed without a shell, including metacharacters", () => {
	const path = "/tmp/a $(touch bad).png";
	assert.deepEqual(viewerCommand(path, "darwin"), { command: "open", args: ["-a", "Preview", path] });
	assert.deepEqual(viewerCommand(path, "linux"), { command: "xdg-open", args: [path] });
	assert.equal(viewerCommand(path, "linux", true).command, "explorer.exe");
	assert.equal(viewerCommand(path, "win32").command, "explorer.exe");
});
