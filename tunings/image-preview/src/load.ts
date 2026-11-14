import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { imageMime, MAX_IMAGE_BYTES, type ImageData, type PreviewSource } from "./images.ts";

export async function loadImage(source: PreviewSource): Promise<ImageData> {
	let bytes: Buffer;
	if ("path" in source) {
		const file = await open(source.path, constants.O_RDONLY | constants.O_NONBLOCK);
		try {
			const stat = await file.stat();
			if (!stat.isFile()) throw new Error("Not a regular file");
			if (stat.size > MAX_IMAGE_BYTES) throw new Error("Image exceeds 20 MiB");
			// Bound the read even if the file grows after stat().
			bytes = Buffer.alloc(stat.size + 1);
			let offset = 0;
			while (offset < bytes.length) {
				const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, null);
				if (!bytesRead) break;
				offset += bytesRead;
			}
			if (offset > stat.size) throw new Error("Image changed while reading; try again");
			bytes = bytes.subarray(0, offset);
		} finally {
			await file.close();
		}
	} else {
		if (source.image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error("Image exceeds 20 MiB");
		bytes = Buffer.from(source.image.data, "base64");
	}
	const mimeType = imageMime(bytes);
	if (!mimeType) throw new Error("Not a supported PNG, JPEG, GIF, or WebP image");
	return { type: "image", data: bytes.toString("base64"), mimeType };
}
