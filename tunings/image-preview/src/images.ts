import { homedir } from "node:os";
import { resolve } from "node:path";

export interface ImageData {
	type: "image";
	data: string;
	mimeType: string;
}

export type PreviewSource =
	| { key: string; label: string; path: string }
	| { key: string; label: string; image: ImageData };

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp)$/i;

export interface ImagePathReference {
	start: number;
	end: number;
	original: string;
	path: string;
}

export function imagePathReferences(text: string, cwd: string, home = homedir()): ImagePathReference[] {
	const spans: { start: number; end: number; original: string }[] = [];
	const add = (original: string, start: number) => {
		const end = start + original.length;
		if (!spans.some((span) => start < span.end && end > span.start)) spans.push({ original, start, end });
	};
	for (const match of text.matchAll(/@?"[^"\n]+"|@?'[^'\n]+'/g)) add(match[0], match.index);
	// Finder inserts unquoted absolute paths with spaces; stop at the first image extension boundary.
	for (const match of text.matchAll(/(?:^|[\s(])(@?(?:\/|~\/|\.{1,2}\/|[a-z]:[\\/])(?:(?!\s+@?(?:\/|~\/|\.{1,2}\/|[a-z]:[\\/]))[^"'\n])*?\.(?:png|jpe?g|gif|webp))(?=$|[\s),;])/gi)) {
		add(match[1], match.index + match[0].length - match[1].length);
	}
	for (const match of text.matchAll(/(?:\\[^\r\n]|[^\s"'\x60])+/g)) add(match[0], match.index);
	return spans.sort((a, b) => a.start - b.start).flatMap((span) => {
		let token = span.original.replace(/^@/, "");
		if (/^["']/.test(token)) token = token.slice(1, -1);
		else token = token.replace(/\\([ ()])/g, "$1").replace(/^\(/, "").replace(/[),;]+$/, "");
		if (!IMAGE_PATH.test(token) || /^[a-z][a-z\d+.-]*:\/\//i.test(token)) return [];
		if (token.startsWith("~/")) token = resolve(home, token.slice(2));
		return [{ ...span, path: resolve(cwd, token) }];
	});
}

export function imagePaths(text: string, cwd: string, home = homedir()): string[] {
	return [...new Set(imagePathReferences(text, cwd, home).map((reference) => reference.path))];
}

export function textSources(text: string, cwd: string): PreviewSource[] {
	return imagePaths(text, cwd).map((path) => ({ key: path, label: path, path }));
}

interface BranchEntry {
	type: string;
	id: string;
	message?: { role: string; content?: unknown };
}

export function branchImages(entries: readonly BranchEntry[], cwd: string): PreviewSource[] {
	const sources: PreviewSource[] = [];
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message?.role !== "user") continue;
		const content = entry.message.content;
		const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
		if (!Array.isArray(blocks)) continue;
		let number = 0;
		for (const block of blocks) {
			if (!block || typeof block !== "object") continue;
			if (block.type === "text" && typeof block.text === "string") {
				sources.push(...textSources(block.text, cwd));
			} else if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
				number++;
				sources.push({ key: `${entry.id}:${number}`, label: `Attachment ${number} · ${entry.id}`, image: block });
			}
		}
	}
	return uniqueSources(sources);
}

export function uniqueSources(sources: readonly PreviewSource[]): PreviewSource[] {
	const seen = new Set<string>();
	return sources.filter((source) => {
		if (seen.has(source.key)) return false;
		seen.add(source.key);
		return true;
	});
}

export function imageMime(bytes: Uint8Array): string | undefined {
	if (bytes.length >= 24 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
	if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
	const header = Buffer.from(bytes.subarray(0, 12)).toString("ascii");
	if (/^GIF8[79]a/.test(header)) return "image/gif";
	if (header.startsWith("RIFF") && header.slice(8) === "WEBP") return "image/webp";
	return undefined;
}

export interface Chip {
	index: number;
	start: number;
	end: number;
}

export function chipLayout(count: number, width: number, prefix: string, numbers?: readonly number[]): { text: string; chips: Chip[] } {
	let text = prefix.slice(0, Math.max(0, width));
	const chips: Chip[] = [];
	for (let index = 0; index < count; index++) {
		const label = `[Image #${numbers?.[index] ?? index + 1}]`;
		if (text.length + label.length > width) break;
		chips.push({ index, start: text.length, end: text.length + label.length });
		text += label + " ";
	}
	return { text: text.trimEnd(), chips };
}

export function viewerCommand(path: string, platform: string, wsl = false): { command: string; args: string[] } {
	if (platform === "darwin") return { command: "open", args: ["-a", "Preview", path] };
	if (platform === "win32" || wsl) return { command: "explorer.exe", args: [path] };
	return { command: "xdg-open", args: [path] };
}
