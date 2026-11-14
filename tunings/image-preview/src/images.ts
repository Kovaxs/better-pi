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

export function imagePaths(text: string, cwd: string, home = homedir()): string[] {
	const paths: string[] = [];
	// Quoted paths and backslash-escaped spaces cover Finder drops and shell-style pastes.
	const tokens = text.match(/@?"[^"\n]+"|@?'[^'\n]+'|(?:\\[^\r\n]|[^\s"'\x60])+/g) ?? [];
	for (let token of tokens) {
		token = token.replace(/^@/, "");
		if (/^["']/.test(token)) token = token.slice(1, -1);
		else token = token.replace(/\\([ ()])/g, "$1").replace(/^\(/, "").replace(/[),;]+$/, "");
		if (!IMAGE_PATH.test(token) || /^[a-z][a-z\d+.-]*:\/\//i.test(token)) continue;
		if (token.startsWith("~/")) token = resolve(home, token.slice(2));
		const path = resolve(cwd, token);
		if (!paths.includes(path)) paths.push(path);
	}
	return paths;
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

export function chipLayout(count: number, width: number, prefix: string): { text: string; chips: Chip[] } {
	let text = prefix.slice(0, Math.max(0, width));
	const chips: Chip[] = [];
	for (let index = 0; index < count; index++) {
		const label = `[Image #${index + 1}]`;
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
