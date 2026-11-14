import { inflateSync } from "node:zlib";

export interface Pixels {
	width: number;
	height: number;
	rgba: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
	return da <= db && da <= dc ? a : db <= dc ? b : c;
}

export function decodePng(bytes: Buffer): Pixels {
	if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("Not PNG");
	let width = 0, height = 0, channels = 0, color = 0;
	let palette: Buffer | undefined, alpha: Buffer | undefined;
	const chunks: Buffer[] = [];
	for (let offset = 8; offset + 12 <= bytes.length;) {
		const length = bytes.readUInt32BE(offset);
		if (offset + length + 12 > bytes.length) throw new Error("Truncated PNG");
		const type = bytes.toString("ascii", offset + 4, offset + 8);
		const data = bytes.subarray(offset + 8, offset + 8 + length);
		if (type === "IHDR") {
			if (length !== 13 || width) throw new Error("Invalid PNG header");
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			color = data[9];
			channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color] ?? 0;
			if (data[8] !== 8 || data[10] || data[11] || data[12] || !channels) throw new Error("Unsupported PNG encoding");
			if (!width || !height || width * height > 16_000_000) throw new Error("PNG exceeds preview pixel limit");
		} else if (type === "IDAT") chunks.push(data);
		else if (type === "PLTE") palette = data;
		else if (type === "tRNS") alpha = data;
		else if (type === "IEND") break;
		offset += length + 12;
	}
	if (!width || !chunks.length || (color === 3 && !palette)) throw new Error("Incomplete PNG");
	const stride = width * channels;
	const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height });
	if (raw.length !== (stride + 1) * height) throw new Error("Invalid PNG pixel data");
	const rgba = new Uint8Array(width * height * 4);
	let previous = Buffer.alloc(stride), row = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const start = y * (stride + 1);
		const filter = raw[start];
		if (filter > 4) throw new Error("Invalid PNG filter");
		for (let x = 0; x < stride; x++) {
			const a = x >= channels ? row[x - channels] : 0;
			const b = previous[x];
			const c = x >= channels ? previous[x - channels] : 0;
			const prediction = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
			row[x] = (raw[start + 1 + x] + prediction) & 255;
		}
		for (let x = 0; x < width; x++) {
			const from = x * channels, to = (y * width + x) * 4;
			if (color === 3) {
				const index = row[from];
				if (index * 3 + 2 >= palette!.length) throw new Error("Invalid PNG palette index");
				for (let c = 0; c < 3; c++) rgba[to + c] = palette![index * 3 + c];
				rgba[to + 3] = alpha?.[index] ?? 255;
			} else if (color === 0 || color === 4) {
				rgba.fill(row[from], to, to + 3);
				rgba[to + 3] = color === 4 ? row[from + 1] : alpha?.length === 2 && row[from] === alpha.readUInt16BE(0) ? 0 : 255;
			} else {
				for (let c = 0; c < 3; c++) rgba[to + c] = row[from + c];
				rgba[to + 3] = color === 6 ? row[from + 3] : alpha?.length === 6
					&& row[from] === alpha.readUInt16BE(0) && row[from + 1] === alpha.readUInt16BE(2) && row[from + 2] === alpha.readUInt16BE(4) ? 0 : 255;
			}
		}
		[previous, row] = [row, previous];
	}
	return { width, height, rgba };
}

export function renderPixels(pixels: Pixels, maxWidth: number, maxHeight: number, light = false): string[] {
	if (maxWidth < 1 || maxHeight < 1) return [];
	const scale = Math.min(maxWidth / pixels.width, maxHeight * 2 / pixels.height, 1);
	const columns = Math.min(maxWidth, Math.max(1, Math.floor(pixels.width * scale)));
	const rows = Math.min(maxHeight, Math.max(1, Math.ceil(pixels.height * scale / 2)));
	const background = light ? 245 : 24;
	const sample = (x: number, y: number): string => {
		const px = Math.min(pixels.width - 1, Math.floor((x + 0.5) * pixels.width / columns));
		const py = Math.min(pixels.height - 1, Math.floor((y + 0.5) * pixels.height / (rows * 2)));
		const offset = (py * pixels.width + px) * 4, alpha = pixels.rgba[offset + 3] / 255;
		return [0, 1, 2].map((channel) => Math.round(pixels.rgba[offset + channel] * alpha + background * (1 - alpha))).join(";");
	};
	return Array.from({ length: rows }, (_, row) => {
		let line = "";
		for (let x = 0; x < columns; x++) line += `\x1b[38;2;${sample(x, row * 2)}m\x1b[48;2;${sample(x, row * 2 + 1)}m▀`;
		return line + "\x1b[0m";
	});
}
