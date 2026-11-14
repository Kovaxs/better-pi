import assert from "node:assert/strict";
import { test } from "node:test";
import type { EditorComponent, TuiMouseEvent } from "@earendil-works/pi-tui";
import { imageEditor } from "../src/editor.ts";
import { ImageMarkers } from "../src/markers.ts";

function setup() {
	const calls: unknown[][] = [];
	const base: EditorComponent & { focused: boolean } = {
		focused: false,
		getText() { return text; },
		getExpandedText() { return text; },
		setText(value) { text = value; },
		insertTextAtCursor(value) { text += value; this.onChange?.(text); },
		handleInput(value) {
			if (value === "\r") { this.onSubmit?.(text); text = ""; }
			else text += value;
		},
		render: () => ["border", text, "border"],
		invalidate() {},
		handleMouse: () => { calls.push(["base-mouse"]); return undefined; },
	};
	let text = "";
	const markers = new ImageMarkers("/work");
	const editor = imageEditor(base, markers, {
		hover: (...args) => { calls.push(["hover", ...args]); },
		open: (...args) => { calls.push(["open", ...args]); },
		leave: () => { calls.push(["leave"]); },
		plain: (s) => s,
		measure: (s) => s.length,
	});
	return { base, editor, markers, calls };
}

test("wraps a pre-existing editor, preserving focus, callbacks and expanded prompt text", () => {
	const { base, editor } = setup();
	let submitted = "", changed = "";
	editor.onSubmit = (text) => { submitted = text; };
	editor.onChange = (text) => { changed = text; };
	editor.insertTextAtCursor!("/tmp/pasted image.png");
	assert.equal(base.getText(), "[Image #1]");
	assert.equal(editor.getExpandedText!(), "/tmp/pasted image.png");
	assert.equal(changed, "/tmp/pasted image.png");
	(editor as typeof base).focused = true;
	assert.equal(base.focused, true);
	editor.handleInput("\r");
	assert.equal(submitted, "/tmp/pasted image.png");
	assert.equal(editor.getText(), "");
	editor.setText("some existing draft");
	assert.equal(base.getText(), "some existing draft");
});

test("inline markers receive hover and click events; ordinary mouse input reaches the base editor", () => {
	const { editor, calls } = setup();
	editor.insertTextAtCursor!("/tmp/a.png");
	editor.render(80);
	const event = { type: "move", button: "none", x: 3, y: 1, screenX: 13, screenY: 20, width: 80, height: 3, shift: false, ctrl: false, alt: false } as TuiMouseEvent;
	assert.deepEqual(editor.handleMouse!(event), { handled: true, render: false });
	assert.equal(calls.at(-1)![0], "hover");
	assert.deepEqual(calls.at(-1)!.slice(2), [10, 20, 10]);
	editor.handleMouse!({ ...event, type: "click", button: "left" });
	assert.equal(calls.at(-1)![0], "open");
	editor.handleMouse!({ ...event, x: 50 });
	assert.equal(calls.at(-1)![0], "base-mouse");
});

test("submitting literal dollar signs and quotes in paths never interprets replacements", () => {
	const { editor } = setup();
	let submitted = "";
	editor.onSubmit = (text) => { submitted = text; };
	editor.insertTextAtCursor!('/tmp/$& screen.png');
	editor.handleInput("\r");
	assert.equal(submitted, '/tmp/$& screen.png');
});
