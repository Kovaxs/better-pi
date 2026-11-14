import assert from "node:assert/strict";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { compositeTuiLine, visibleWidth } from "@earendil-works/pi-tui";
import { previewCard } from "../src/card.ts";

export default function renderSmoke(pi: ExtensionAPI) {
	pi.registerCommand("image-preview-render-smoke", {
		handler: async () => {
			const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=";
			const theme = { fg: (_color: string, text: string) => text } as Theme;
			for (const tmux of [false, true]) for (const width of [12, 50, 100, 120]) {
				const card = previewCard({ type: "image", data, mimeType: "image/png", wezterm: { tmux } }, "test.png", theme, 30);
				const anchor = card.render(width).find((line) => line.includes("1337;File="));
				assert.ok(anchor, "Missing native image anchor");
				const composited = compositeTuiLine(" ".repeat(140), anchor, 2, width, 140);
				assert.ok(composited.includes(data), "Pi compositor corrupted the original image");
				assert.ok(composited.includes("doNotMoveCursor=1"));
				assert.ok(visibleWidth(composited) <= 140);
				if (tmux) assert.ok(composited.includes(data + "\x07\x1b\\"));
				card.invalidate();
				assert.ok(card.render(50).some((line) => line.includes(data)));
			}
			console.log("WezTerm: native pixels, tmux passthrough, Pi compositing and resize passed");
		},
	});
}
