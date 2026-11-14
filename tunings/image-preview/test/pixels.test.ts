import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { test } from "node:test";
import { decodePng, renderPixels } from "../src/pixels.ts";

function chunk(type: string, data: Buffer): Buffer {
	const result = Buffer.alloc(data.length + 12);
	result.writeUInt32BE(data.length);
	result.write(type, 4);
	data.copy(result, 8);
	return result;
}

function png(raw: number[], color = 6, width = 1, height = 1, extra: Buffer[] = [], depth = 8, interlace = 0): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width);
	header.writeUInt32BE(height, 4);
	header[8] = depth;
	header[9] = color;
	header[12] = interlace;
	return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), ...extra, chunk("IDAT", deflateSync(Buffer.from(raw))), chunk("IEND", Buffer.alloc(0))]);
}

test("decodes all five PNG row filters into the same pixels", () => {
	for (let filter = 0; filter <= 4; filter++) {
		const first = [10, 20, 30, 255], second = [40, 50, 60, 255];
		const raw = [0, ...first];
		raw.push(filter);
		for (let c = 0; c < 4; c++) {
			const prediction = filter === 2 || filter === 4 ? first[c] : filter === 3 ? Math.floor(first[c] / 2) : 0;
			raw.push((second[c] - prediction + 256) & 255);
		}
		assert.deepEqual([...decodePng(png(raw, 6, 1, 2)).rgba], [...first, ...second]);
	}
	// Sub and Paeth also depend on the previous pixel in the same row.
	assert.deepEqual([...decodePng(png([1, 10,20,30,255, 30,30,30,0], 6, 2)).rgba], [10,20,30,255, 40,50,60,255]);
	assert.deepEqual([...decodePng(png([4, 10,20,30,255, 30,30,30,0], 6, 2)).rgba], [10,20,30,255, 40,50,60,255]);
});

test("handles RGB, gray, gray-alpha and indexed PNGs, including transparency", () => {
	assert.deepEqual([...decodePng(png([0, 1,2,3], 2)).rgba], [1,2,3,255]);
	assert.deepEqual([...decodePng(png([0, 17], 0)).rgba], [17,17,17,255]);
	assert.deepEqual([...decodePng(png([0, 17,128], 4)).rgba], [17,17,17,128]);
	assert.deepEqual([...decodePng(png([0, 0], 3, 1, 1, [chunk("PLTE", Buffer.from([1,2,3])), chunk("tRNS", Buffer.from([128]))])).rgba], [1,2,3,128]);
	assert.deepEqual([...decodePng(png([0, 17], 0, 1, 1, [chunk("tRNS", Buffer.from([0,17]))])).rgba], [17,17,17,0]);
});

test("rejects unsupported encodings, truncated data and decompression bombs", () => {
	assert.throws(() => decodePng(Buffer.alloc(10)));
	assert.throws(() => decodePng(png([0], 6, 0)));
	assert.throws(() => decodePng(png([0], 6, 16_000_001)));
	assert.throws(() => decodePng(png([0,1,2,3,4], 6, 1, 1, [], 16)));
	assert.throws(() => decodePng(png([0,1,2,3,4], 6, 1, 1, [], 8, 1)));
	assert.throws(() => decodePng(png([5,1,2,3,4])));
	assert.throws(() => decodePng(png([0,1,2,3,4]).subarray(0, 30)));
	assert.throws(() => decodePng(png(Array(1000).fill(0))), /larger than|length/i);
});

test("draws visible color blocks without any image protocol and respects narrow bounds", () => {
	const pixels = decodePng(png([0,255,0,0,255, 0,0,0,255,255], 6, 1, 2));
	const lines = renderPixels(pixels, 60, 10);
	assert.equal(lines.length, 1);
	assert.ok(lines[0].includes("\x1b[38;2;255;0;0m"));
	assert.ok(lines[0].includes("\x1b[48;2;0;0;255m▀"));
	assert.deepEqual(renderPixels(pixels, 0, 10), []);
	const transparent = decodePng(png([0,255,0,0,0]));
	assert.ok(renderPixels(transparent, 1, 1)[0].includes("24;24;24"));
	assert.ok(renderPixels(transparent, 1, 1, true)[0].includes("245;245;245"));
});
