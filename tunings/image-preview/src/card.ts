import type { Theme } from "@earendil-works/pi-coding-agent";
import { getCapabilities, Image, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { ImageData } from "./images.ts";

export function previewCard(image: ImageData, label: string, theme: Theme, maxHeight: number): Component {
	const picture = new Image(image.data, image.mimeType, { fallbackColor: (s) => theme.fg("muted", s) }, {
		maxWidthCells: 72,
		maxHeightCells: Math.max(1, maxHeight - 3),
	});
	return {
		render(width) {
			const header = truncateToWidth(theme.fg("accent", label.replace(/\p{Cc}/gu, "")), width);
			const hint = getCapabilities().images
				? "Click chip to open · /image-preview for keyboard access"
				: "No terminal image protocol · use Open in system viewer";
			return [header, ...picture.render(width), truncateToWidth(theme.fg("dim", hint), width)];
		},
		invalidate() { picture.invalidate(); },
	};
}
