import type { EditorComponent, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { PreviewSource } from "./images.ts";
import type { ImageMarkers } from "./markers.ts";

interface Hooks {
	hover(source: PreviewSource, x: number, y: number, width: number): void;
	open(source: PreviewSource): void;
	leave(): void;
	plain(text: string): string;
	measure(text: string): number;
}

export function imageEditor(base: EditorComponent, markers: ImageMarkers, hooks: Hooks): EditorComponent {
	let hits: { source: PreviewSource; x: number; y: number; width: number }[] = [];
	const render = (width: number) => {
		const lines = base.render(width);
		hits = lines.flatMap((line, y) => {
			const plain = hooks.plain(line);
			return [...plain.matchAll(/\[Image #\d+\]/g)].flatMap((match) => {
				const source = markers.source(match[0]);
				return source ? [{ source, x: hooks.measure(plain.slice(0, match.index)), y, width: match[0].length }] : [];
			});
		});
		return lines;
	};
	const handleMouse = (event: TuiMouseEvent): TuiMouseEventResult | undefined => {
		const hit = hits.find((h) => h.y === event.y && event.x >= h.x && event.x < h.x + h.width);
		if (hit) {
			if (event.type === "move") {
				hooks.hover(hit.source, event.screenX - event.x + hit.x, event.screenY, hit.width);
				return { handled: true, render: false };
			}
			if (event.button === "left" && event.type === "click") {
				hooks.leave();
				hooks.open(hit.source);
				return { handled: true };
			}
			if (event.button === "left" && event.type === "press") return { handled: true };
		}
		hooks.leave();
		return base.handleMouse?.(event);
	};
	// Forward every other property/method to the existing editor, including focus, app actions and autocomplete.
	return new Proxy(base, {
		get(target, key) {
			if (key === "render") return render;
			if (key === "handleMouse") return handleMouse;
			if (key === "setText") return (text: string) => target.setText(markers.collapse(text));
			if (key === "getExpandedText") return () => markers.expand(target.getExpandedText?.() ?? target.getText());
			if (key === "insertTextAtCursor" && target.insertTextAtCursor) return (text: string) => target.insertTextAtCursor!(markers.collapse(text));
			const value = Reflect.get(target, key, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
		set(target, key, value) {
			if ((key === "onSubmit" || key === "onChange") && typeof value === "function") {
				return Reflect.set(target, key, (text: string) => value(markers.expand(text)), target);
			}
			return Reflect.set(target, key, value, target);
		},
	});
}
