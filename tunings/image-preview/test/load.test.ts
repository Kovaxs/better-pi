import assert from "node:assert/strict";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadImage } from "../src/load.ts";
import { MAX_IMAGE_BYTES } from "../src/images.ts";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=";

test("loads embedded data and uses its real MIME type", async () => {
	assert.deepEqual(await loadImage({ key: "a", label: "a", image: { type: "image", data: png, mimeType: "image/jpeg" } }),
		{ type: "image", data: png, mimeType: "image/png" });
});

test("loads a local file and rejects missing, invalid, directory and oversized sources", async () => {
	const dir = await mkdtemp(join(tmpdir(), "image-preview-test-"));
	try {
		const path = join(dir, "image.png");
		const source = { key: path, label: path, path };
		await assert.rejects(loadImage(source));
		await writeFile(path, Buffer.from(png, "base64"));
		assert.equal((await loadImage(source)).data, png);
		await writeFile(path, "not an image");
		await assert.rejects(loadImage(source), /Not a supported/);
		await truncate(path, MAX_IMAGE_BYTES + 1);
		await assert.rejects(loadImage(source), /20 MiB/);
		await assert.rejects(loadImage({ key: dir, label: dir, path: dir }), /regular file/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("rejects oversized or malformed embedded data", async () => {
	await assert.rejects(loadImage({ key: "a", label: "a", image: { type: "image", data: "x".repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1), mimeType: "image/png" } }), /20 MiB/);
	await assert.rejects(loadImage({ key: "a", label: "a", image: { type: "image", data: "oops", mimeType: "image/png" } }), /Not a supported/);
});
