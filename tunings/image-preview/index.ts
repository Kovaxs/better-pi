import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertToPng, CustomEditor, resizeImage, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCapabilities, stripTerminalSequences, truncateToWidth, visibleWidth, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import { previewCard, type PreviewImage } from "./src/card.ts";
import { branchImages, chipLayout, textSources, uniqueSources, viewerCommand, type PreviewSource } from "./src/images.ts";
import { loadImage } from "./src/load.ts";
import { imageEditor } from "./src/editor.ts";
import { ImageMarkers } from "./src/markers.ts";
import { enableHoverMotion } from "./src/mouse.ts";
import { decodePng } from "./src/pixels.ts";
import { isTmux, isWezTerm } from "./src/protocol.ts";

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
	let markers: ImageMarkers | undefined;
	let editorText: (() => string) | undefined;
	let restoreEditor: (() => void) | undefined;
	let restoreMotion: (() => void) | undefined;
	let wezterm = false;
	let passthrough = false;

	pi.registerFlag("image-preview-terminal", {
		description: "Image preview terminal: auto or wezterm (use when tmux hides terminal identification)",
		type: "string",
		default: "auto",
	});

	function closeHover() {
		hoverGeneration++;
		const wasVisible = overlay !== undefined;
		overlay?.hide();
		overlay = undefined;
		if (wasVisible && wezterm) tui?.requestRender(true);
		hovered = undefined;
		target = undefined;
	}

	async function prepare(source: PreviewSource): Promise<PreviewImage> {
		let image = await loadImage(source);
		if (wezterm) {
			// Leave headroom for OSC/DCS framing under tmux\u0027s default 1 MiB input buffer.
			if (passthrough && image.data.length > 900_000) {
				const resized = await resizeImage(Buffer.from(image.data, "base64"), image.mimeType, {
					maxWidth: 4096, maxHeight: 4096, maxBytes: 650_000, jpegQuality: 95,
				});
				if (!resized) throw new Error("Image is too large for tmux preview; open the original instead");
				image = { type: "image", data: resized.data, mimeType: resized.mimeType };
			}
			return { ...image, wezterm: { tmux: passthrough } };
		}
		const protocol = getCapabilities().images;
		if ((protocol === "kitty" || !protocol) && image.mimeType !== "image/png") {
			const converted = await convertToPng(image.data, image.mimeType);
			if (converted) image = { type: "image", ...converted };
		}
		if (!protocol && image.mimeType === "image/png") {
			try { return { ...image, pixels: decodePng(Buffer.from(image.data, "base64")) }; }
			catch { /* Unusual encodings retain the metadata/system-viewer fallback. */ }
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
			const height = Math.min(wezterm ? 30 : 18, y);
			const columns = Math.min(wezterm ? 120 : 76, tui.terminal.columns);
			if (height < 4) return;
			const card = previewCard(image, source.label, current.ui.theme, height);
			overlay = tui.showOverlay(card, {
				nonCapturing: true,
				row: Math.max(0, y - card.render(columns).length),
				col: 0, width: columns, maxHeight: height,
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
					const layout = chipLayout(sources.length, width, prefix, draft.length ? sources.map((source, i) => markers?.numberForPath(source.key) ?? i + 1) : undefined);
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
		const candidates = uniqueSources([
			...(markers?.sourcesIn(editorText?.() ?? "") ?? []),
			...textSources(text, current.cwd),
		]).slice(0, 24);
		const results = await Promise.all(candidates.map(async (source) => {
			try { return "path" in source && (await stat(source.path)).isFile() ? source : undefined; }
			catch { return undefined; }
		}));
		if (token !== generation || ctx !== current) return;
		draft = results.filter((source) => source !== undefined);
		for (const source of draft) {
			if ("path" in source && markers?.numberForPath(source.path) === undefined) markers?.collapse(source.path);
		}
		updateWidget();
	}

	function rebuild(current: ExtensionContext) {
		if (current.mode !== "tui") return;
		closeHover();
		history = branchImages(current.sessionManager.getBranch(), current.cwd);
		updateWidget();
	}

	pi.on("session_start", async (_event, current) => {
		if (current.mode !== "tui") return;
		ctx = current;
		wezterm = isWezTerm(process.env, String(pi.getFlag("image-preview-terminal")));
		passthrough = wezterm && isTmux(process.env);
		if (passthrough) {
			try {
				const result = await pi.exec("tmux", ["show-option", "-gv", "allow-passthrough"], { timeout: 3000, maxBuffer: 1024 });
				if (result.code !== 0 || !["on", "all"].includes(result.stdout.trim())) {
					wezterm = false;
					current.ui.notify("Image preview: enable sharp images in tmux with: set -g allow-passthrough on", "warning");
				}
			} catch { wezterm = false; }
		}
		markers = new ImageMarkers(current.cwd);
		const registry = markers;
		const previous = current.ui.getEditorComponent();
		const factory: NonNullable<typeof previous> = (host, theme, keys) => {
			if (tui !== host) {
				restoreMotion?.();
				tui = host;
				restoreMotion = enableHoverMotion(host);
			}
			const base = previous?.(host, theme, keys) ?? new CustomEditor(host, theme, keys);
			editorText = () => base.getText();
			return imageEditor(base, registry, {
				hover: (source, x, y, width) => { void hover(source, x, y, width); },
				open: (source) => { void openViewer(source); },
				leave: closeHover,
				plain: stripTerminalSequences,
				measure: visibleWidth,
			});
		};
		current.ui.setEditorComponent(factory);
		restoreEditor = () => {
			if (current.ui.getEditorComponent() === factory) current.ui.setEditorComponent(previous);
		};
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
			if (wezterm) tui?.requestRender(true);
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
		restoreMotion?.();
		restoreMotion = undefined;
		restoreEditor?.();
		restoreEditor = undefined;
		editorText = undefined;
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
