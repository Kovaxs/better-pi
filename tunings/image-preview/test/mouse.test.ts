import assert from "node:assert/strict";
import { test } from "node:test";
import { enableHoverMotion } from "../src/mouse.ts";

test("requests real passive mouse motion in fullscreen tmux and restores button-motion once", () => {
	const writes: string[] = [];
	const restore = enableHoverMotion({ mode: "fullscreen", terminal: { write: (s) => { writes.push(s); } } }, { TMUX: "/tmp/tmux" });
	assert.deepEqual(writes, ["\x1b[?1003h"]);
	restore();
	restore();
	assert.deepEqual(writes, ["\x1b[?1003h", "\x1b[?1003l\x1b[?1002h"]);
});

test("recognizes other multiplexers, and never alters regular mode or native terminal tracking", () => {
	for (const env of [{ ZELLIJ: "1" }, { STY: "session" }, { TERM: "tmux-256color" }, { TERM: "screen" }]) {
		const writes: string[] = [];
		enableHoverMotion({ mode: "fullscreen", terminal: { write: (s) => { writes.push(s); } } }, env)();
		assert.equal(writes.length, 2);
	}
	for (const [mode, env] of [["regular", { TMUX: "yes" }], ["fullscreen", { TERM: "xterm-kitty" }]] as const) {
		const writes: string[] = [];
		enableHoverMotion({ mode, terminal: { write: (s) => { writes.push(s); } } }, env)();
		assert.equal(writes.length, 0);
	}
});
