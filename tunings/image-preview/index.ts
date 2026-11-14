import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertToPng, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCapabilities, truncateToWidth, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import { previewCard } from "./src/card.ts";
import { branchImages, chipLayout, textSources, uniqueSources, viewerCommand, type ImageData, type PreviewSource } from "./src/images.ts";
import { loadImage } from "./src/load.ts";

export default function imagePreview(pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let unsubscribe: (() => void) | undefined;
	let overlay: OverlayHandle | undefined;
	let sources: PreviewSource[] = [];
	let history: PreviewSource[] = [];
	let draft: PreviewSource[] = [];
	let lastText: string | undefined;
	let generation = 0;
	let hoverGeneration = 0;
	let hovered: string | undefined;
	let target: { x: number; y: number; width: number } | undefined;
	let tempDir: string | undefined;
	let opening = false;

	function closeHover() {
		hoverGeneration++;
		overlay?.hide();
		overlay = undefined;
		hovered = undefined;
		target = undefined;
	}

	async function prepare(source: PreviewSource): Promise<ImageData> {
		const image = await loadImage(source);
		if (getCapabilities().images === "kitty" && image.mimeType !== "image/png") {
			const converted = await convertToPng(image.data, image.mimeType);
			return converted ? { type: "image", ...converted } : image;
		}
		return image;
	}

	async function openViewer(source: PreviewSource) {
		if (!ctx || opening) return;
		const current = ctx;
		if (process.env.SSH_CONNECTION || process.env.SSH_TTY) {
			current.ui.notify("Image preview: the system viewer is disabled over SSH. Use a terminal with image support.", "warning");
			return;
		}
		opening = true;
		try {
			const image = await loadImage(source);
			if (ctx !== current) return;
			let path: string;
			if ("path" in source) path = source.path;
			else {
				const dir = tempDir ?? await mkdtemp(join(tmpdir(), "pi-image-preview-"));
				if (ctx !== current) { await rm(dir, { recursive: true, force: true }); return; }
				tempDir = dir;
				const ext = image.mimeType.split("/")[1];
				path = join(tempDir, createHash("sha256").update(image.data).digest("hex") + "." + ext);
				await writeFile(path, Buffer.from(image.data, "base64"), { mode: 0o600 });
			}
			if (process.env.WSL_DISTRO_NAME) {
				const result = await pi.exec("wslpath", ["-w", path], { timeout: 5000 });
				if (result.code !== 0) throw new Error("Could not convert WSL image path");
				path = result.stdout.trim();
			}
			if (ctx !== current) return;
			const viewer = viewerCommand(path, process.platform, !!process.env.WSL_DISTRO_NAME);
			const result = await pi.exec(viewer.command, viewer.args, { timeout: 10000, maxBuffer: 4096 });
			// Explorer can report a nonzero status even when it opens the file.
			if (result.code !== 0 && viewer.command !== "explorer.exe") throw new Error(result.stderr.trim() || "System viewer could not open the image");
		} catch (error) {
			if (ctx === current) current.ui.notify(`Image preview: ${error instanceof Error ? error.message : String(error)}`, "warning");
		} finally {
			opening = false;
		}
	}

	async function hover(source: PreviewSource, x: number, y: number, width: number) {
		if (!ctx || !tui || hovered === source.key) return;
		closeHover();
		hovered = source.key;
		target = { x, y, width };
		const token = hoverGeneration;
		const current = ctx;
		try {
			const image = await prepare(source);
			if (token !== hoverGeneration || ctx !== current || !tui) return;
			const height = Math.min(18, y);
			if (height < 4) return;
			const card = previewCard(image, source.label, current.ui.theme, height);
			overlay = tui.showOverlay(card, {
				nonCapturing: true,
				row: Math.max(0, y - card.render(Math.min(76, tui.terminal.columns)).length),
				col: 0, width: Math.min(76, tui.terminal.columns), maxHeight: height,
			});
		} catch {
			// Missing or unsupported files remain available through the command, which reports errors.
		}
	}

	function updateWidget() {
		if (!ctx || !tui) return;
		closeHover();
		sources = draft.length ? draft : history.slice(-6);
		const current = ctx;
		if (!sources.length) {
			current.ui.setWidget("image-preview", undefined);
			return;
		}
		const prefix = draft.length ? "Draft: " : "Recent: ";
		current.ui.setWidget("image-preview", (host, theme) => {
			let chips: ReturnType<typeof chipLayout>["chips"] = [];
			return {
				render(width) {
					const layout = chipLayout(sources.length, width, prefix);
					chips = layout.chips;
					const hint = host.mode === "fullscreen" ? " · hover to preview · click to open" : " · /image-preview";
					return [truncateToWidth(theme.fg("accent", layout.text) + theme.fg("dim", hint), width)];
				},
				handleMouse(event) {
					const chip = event.y === 0 ? chips.find((c) => event.x >= c.start && event.x < c.end) : undefined;
					if (!chip) { closeHover(); return undefined; }
					const source = sources[chip.index];
					if (event.type === "move") {
						void hover(source, event.screenX - event.x + chip.start, event.screenY, chip.end - chip.start);
						return { handled: true, render: false };
					}
					if (event.type === "click" && event.button === "left") {
						closeHover();
						void openViewer(source);
						return { handled: true };
					}
					return undefined;
				},
				invalidate() { closeHover(); },
				dispose() { closeHover(); },
			};
		});
	}

	async function scanDraft() {
		if (!ctx) return;
		const current = ctx;
		const text = current.ui.getEditorText();
		if (text === lastText) return;
		lastText = text;
		closeHover();
		const token = ++generation;
		const candidates = textSources(text, current.cwd).slice(0, 24);
		const results = await Promise.all(candidates.map(async (source) => {
			try { return "path" in source && (await stat(source.path)).isFile() ? source : undefined; }
			catch { return undefined; }
		}));
		if (token !== generation || ctx !== current) return;
		draft = results.filter((source) => source !== undefined);
		updateWidget();
	}

	function rebuild(current: ExtensionContext) {
		if (current.mode !== "tui") return;
		closeHover();
		history = branchImages(current.sessionManager.getBranch(), current.cwd);
		updateWidget();
	}

	pi.on("session_start", (_event, current) => {
		if (current.mode !== "tui") return;
		ctx = current;
		// A widget factory supplies the host TUI without replacing the editor or footer.
		current.ui.setWidget("image-preview", (host) => {
			tui = host;
			return { render: () => [], invalidate() {} };
		});
		rebuild(current);
		unsubscribe = current.ui.onTerminalInput((data) => {
			const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data);
			if (!mouse) { closeHover(); return; }
			const code = Number(mouse[1]);
			const x = Number(mouse[2]) - 1;
			const y = Number(mouse[3]) - 1;
			if (!target || (code & 64) || y !== target.y || x < target.x || x >= target.x + target.width) closeHover();
		});
		// Clipboard paste inserts a temporary file path asynchronously, without an input/edit event.
		timer = setInterval(() => { void scanDraft(); }, 300);
		void scanDraft();
	});

	pi.on("message_end", (event, current) => {
		if (current.mode !== "tui" || event.message.role !== "user") return;
		const message = event.message;
		const branch = current.sessionManager.getBranch();
		const persisted = branch.some((entry) => entry.type === "message" && entry.message.role === "user" && entry.message.timestamp === message.timestamp);
		// message_end may precede the user message's session append; settled rebuilds its real entry ID.
		history = branchImages(persisted ? branch : [...branch, { type: "message", id: `live-${message.timestamp}`, message }], current.cwd);
		updateWidget();
	});
	pi.on("agent_settled", (_event, current) => rebuild(current));
	pi.on("session_tree", (_event, current) => rebuild(current));

	async function showPreview(args: string, current: ExtensionContext) {
		if (current.mode !== "tui") return;
		closeHover();
		lastText = undefined;
		await scanDraft();
		const all = uniqueSources([...draft, ...history.slice().reverse()]);
		if (!all.length) { current.ui.notify("No images found in the draft or current branch.", "info"); return; }
		const choices = all.map((source, i) => `${i + 1}. ${source.label.replace(/\p{Cc}/gu, "")}`);
		const choice = all.length === 1 ? choices[0] : await current.ui.select("Image preview", choices);
		if (!choice) return;
		const source = all[choices.indexOf(choice)];
		if (args.trim() === "open") { await openViewer(source); return; }
		try {
			const image = await prepare(source);
			const action = await current.ui.custom<"open" | undefined>((host, theme, keys, done) => {
				const card = previewCard(image, source.label, theme, Math.max(4, host.terminal.rows - 6));
				return {
					render: (width) => [...card.render(width), truncateToWidth(theme.fg("dim", "Enter: open in system viewer · Esc: close"), width)],
					invalidate: () => card.invalidate(),
					handleInput(data) {
						if (keys.matches(data, "tui.select.cancel")) done(undefined);
						else if (keys.matches(data, "tui.select.confirm")) done("open");
					},
				};
			}, { overlay: true, overlayOptions: { width: "90%", maxHeight: "90%" } });
			if (action === "open") await openViewer(source);
		} catch (error) {
			current.ui.notify(`Image preview: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	}

	pi.registerCommand("image-preview", {
		description: "Preview draft/recent images; use 'open' to open the system viewer",
		handler: showPreview,
	});
	pi.registerShortcut("ctrl+shift+i", {
		description: "Preview images without submitting the draft",
		handler: (current) => showPreview("", current),
	});

	pi.on("session_shutdown", async () => {
		ctx = undefined;
		generation++;
		if (timer) clearInterval(timer);
		timer = undefined;
		unsubscribe?.();
		unsubscribe = undefined;
		closeHover();
		tui = undefined;
		if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		tempDir = undefined;
	});
}
