import { homedir } from "node:os";
import { imagePathReferences, type PreviewSource } from "./images.ts";

export class ImageMarkers {
	private entries = new Map<string, { original: string; source: PreviewSource }>();

	private cwd: string;
	private home: string;

	constructor(cwd: string, home = homedir()) {
		this.cwd = cwd;
		this.home = home;
	}

	collapse(text: string): string {
		const references = imagePathReferences(text, this.cwd, this.home).filter(({ original }) =>
			/^@?["']?(?:\/|~\/|\.{1,2}\/|[a-z]:[\\/])/i.test(original));
		let result = "", offset = 0;
		for (const { original, path, start, end } of references) {
			let marker = [...this.entries].find(([, entry]) => entry.original === original)?.[0];
			if (!marker) {
				marker = `[Image #${this.entries.size + 1}]`;
				this.entries.set(marker, { original, source: { key: path, label: path, path } });
			}
			result += text.slice(offset, start) + marker;
			offset = end;
		}
		return result + text.slice(offset);
	}

	expand(text: string): string {
		return text.replace(/\[Image #\d+\]/g, (marker) => this.entries.get(marker)?.original ?? marker);
	}

	source(marker: string): PreviewSource | undefined {
		return this.entries.get(marker)?.source;
	}

	numberForPath(path: string): number | undefined {
		for (const [marker, { source }] of this.entries) {
			if (source.key === path) return Number(/#(\d+)/.exec(marker)![1]);
		}
	}

	sourcesIn(text: string): PreviewSource[] {
		return [...text.matchAll(/\[Image #\d+\]/g)]
			.flatMap(([marker]) => this.source(marker) ?? []);
	}
}
