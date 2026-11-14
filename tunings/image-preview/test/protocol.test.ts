import assert from "node:assert/strict";
import { test } from "node:test";
import { isTmux, isWezTerm, tmuxPassthrough, wezTermImageLines } from "../src/protocol.ts";

test("detects WezTerm directly and through tmux, without mistaking unrelated terminals", () => {
	assert.equal(isWezTerm({ TERM_PROGRAM: "WezTerm" }), true);
	assert.equal(isWezTerm({ TERM_PROGRAM: "tmux", WEZTERM_PANE: "0" }), true);
	assert.equal(isWezTerm({ TERM_PROGRAM: "ghostty" }), false);
	assert.equal(isWezTerm({ TERM_PROGRAM: "tmux" }, "wezterm"), true);
	assert.equal(isTmux({ TMUX: "session" }), true);
	assert.equal(isTmux({ TERM: "tmux-256color" }), true);
	assert.equal(isTmux({ TERM_PROGRAM: "wezterm" }), false);
});

test("tmux transport doubles every escape and leaves the original image data intact", () => {
	const osc = "\x1b]1337;File=inline=1:YWJj\x07";
	const wrapped = tmuxPassthrough(osc);
	assert.equal(wrapped, "\x1bPtmux;\x1b\x1b]1337;File=inline=1:YWJj\x07\x1b\\");
	assert.equal(wrapped.slice(7, -2).replaceAll("\x1b\x1b", "\x1b"), osc);
});

test("native image lines reserve height, restore cursor row, and account for older pi DCS parsing", () => {
	const osc = "\x1b]1337;File=doNotMoveCursor=1:YWJj\x07";
	assert.deepEqual(wezTermImageLines(osc, 2, false, () => 0), ["", "\x1b[1A\x1b[0m" + osc + "\x1b[1B\x1b[0m"]);
	const lines = wezTermImageLines(osc, 3, true, () => 7);
	assert.equal(lines.length, 3);
	assert.ok(lines[2].includes(tmuxPassthrough(osc)));
	assert.ok(lines[2].endsWith("\x1b[2B\x1b[0m\x1b[7C\x1b[0m"));
});
