import type { Theme } from "@earendil-works/pi-coding-agent";
import { calculateImageRows, encodeITerm2, getCapabilities, getCellDimensions, getImageDimensions, Image, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { ImageData } from "./images.ts";
import { renderPixels, type Pixels } from "./pixels.ts";

import { wezTermImageLines } from "./protocol.ts";

export type PreviewImage = ImageData & { pixels?: Pixels; wezterm?: { tmux: boolean } };

export function previewCard(image: PreviewImage, label: string, theme: Theme, maxHeight: number): Component {
	const picture = new Image(image.data, image.mimeType, { fallbackColor: (s) => theme.fg("muted", s) }, {
		maxWidthCells: 72,
		maxHeightCells: Math.max(1, maxHeight - 3),
	});
	const dimensions = image.wezterm ? getImageDimensions(image.data, image.mimeType) : undefined;
	let cachedWidth: number | undefined;
	let native: string[] | undefined;
	return {
		render(width) {
			const header = truncateToWidth(theme.fg("accent", label.replace(/\p{Cc}/gu, "")), width);
			if (image.wezterm && dimensions && width >= 12 && cachedWidth !== width) {
				const cells = getCellDimensions();
				const maxRows = Math.max(1, maxHeight - 3);
				const columns = Math.max(1, Math.min(120, width, Math.floor(maxRows * cells.heightPx * dimensions.widthPx / (dimensions.heightPx * cells.widthPx))));
				const size = { columns, rows: Math.min(maxRows, calculateImageRows(dimensions, columns, cells)) };
				const sequence = encodeITerm2(image.data, { width: size.columns, height: size.rows, preserveAspectRatio: true })
					.replace("File=", "File=doNotMoveCursor=1;");
				native = wezTermImageLines(sequence, size.rows, image.wezterm.tmux, visibleWidth);
				cachedWidth = width;
			} else if (width < 12) native = undefined;
			const blocks = !native && !getCapabilities().images && image.pixels
				? renderPixels(image.pixels, Math.min(72, width), Math.max(1, maxHeight - 3), theme.appearance === "light")
				: undefined;
			const hint = native || getCapabilities().images || blocks
				? "Click image chip to open original · /image-preview"
				: "Cannot draw this encoding · use Open in system viewer";
			return [header, ...(native ?? blocks ?? picture.render(width)), truncateToWidth(theme.fg("dim", hint), width)];
		},
		invalidate() { picture.invalidate(); cachedWidth = undefined; native = undefined; },
	};
}
