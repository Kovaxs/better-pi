import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import commit from "../index.ts";
import { CHOICES } from "../src/request.ts";

function harness(t: test.TestContext, options: { hasUI?: boolean; mode?: ExtensionContext["mode"]; clean?: boolean; missing?: boolean; noRepo?: boolean; busy?: boolean; choice?: string; select?: () => Promise<string | undefined> } = {}) {
	const root = mkdtempSync(join(tmpdir(), "betterpi-commit-command-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	if (!options.noRepo) writeFileSync(join(root, ".git"), "gitdir: /fixture");
	let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
	const events = new Map<string, (event: any, ctx: ExtensionContext) => any>();
	const messages: string[] = [];
	const notices: string[] = [];
	const calls: string[][] = [];
	let selections = 0;
	let idle = !options.busy;
	const ctx = {
		cwd: root,
		mode: options.mode ?? (options.hasUI === false ? "print" : "tui"),
		hasUI: options.hasUI !== false,
		isIdle: () => idle,
		ui: {
			select: async () => {
				selections++;
				return options.select ? options.select() : options.choice;
			},
			notify: (message: string) => notices.push(message),
		},
	} as unknown as ExtensionCommandContext;
	const pi = {
		on: (name: string, handler: (event: any, ctx: ExtensionContext) => any) => events.set(name, handler),
		registerCommand: (name: string, definition: { handler: typeof handler }) => {
			assert.equal(name, "commit");
			handler = definition.handler;
		},
		exec: async (_command: string, args: string[]) => {
			calls.push(args);
			if (options.missing) throw new Error("spawn git ENOENT");
			const stdout = args.includes("status") ? (options.clean ? "" : " M a.ts\n")
				: args.includes("branch") ? "main\n" : "";
			return { stdout, stderr: "", code: 0 };
		},
		sendUserMessage: (message: string) => messages.push(message),
	} as unknown as ExtensionAPI;
	commit(pi);
	events.get("session_start")!({ reason: "startup" }, ctx);
	async function input(text: string) {
		const result = await events.get("input")!({ text, source: "interactive" }, ctx);
		if (result?.action === "transform") messages.push(result.text);
		return result;
	}
	return {
		run: (args = "") => handler ? handler(args, ctx) : input(`/commit ${args}`),
		input, messages, notices, calls,
		setIdle: (value: boolean) => { idle = value; },
		selections: () => selections,
	};
}

test("interactive selection maps every action and starts one task", async (t) => {
	for (const choice of CHOICES) {
		const h = harness(t, { choice: choice.label });
		await h.run();
		assert.equal(h.selections(), 1);
		assert.equal(h.messages.length, 1);
		assert.match(h.messages[0], choice.action === "only" ? /WITHOUT pushing/ : /then push/);
		assert.equal(h.calls.length, 5);
	}
});

test("cancelled menus never inspect or mutate the repository or start a task", async (t) => {
	const h = harness(t);
	await h.run();
	assert.equal(h.messages.length, 0);
	assert.equal(h.calls.length, 0);
});

test("bare print mode defaults to commit-only and never calls UI", async (t) => {
	const h = harness(t, { hasUI: false, select: async () => { throw new Error("UI must not be called"); } });
	await h.run();
	assert.equal(h.selections(), 0);
	assert.equal(h.messages.length, 1);
	assert.match(h.messages[0], /WITHOUT pushing/);
});

test("headless input transforms only /commit and keeps its task in the original awaited prompt", async (t) => {
	for (const mode of ["print", "json"] as const) {
		const h = harness(t, { hasUI: false, mode });
		assert.equal(await h.input("hello"), undefined);
		assert.equal(await h.input("/commitment"), undefined);
		const result = await h.input("/commit only");
		assert.equal(result.action, "transform");
		assert.match(result.text, /WITHOUT pushing/);
		assert.equal(h.messages.length, 1);
	}
});

test("RPC uses the dialog and cancellation does not fall back to pushing", async (t) => {
	const h = harness(t, { mode: "rpc" });
	await h.run();
	assert.equal(h.selections(), 1);
	assert.equal(h.messages.length, 0);
	assert.equal(h.calls.length, 0);
});

test("explicit modes bypass UI, including pushing and a named new branch", async (t) => {
	for (const args of ["only", "push", "branch feat/commit"]) {
		const h = harness(t, { hasUI: false });
		await h.run(args);
		assert.equal(h.selections(), 0);
		assert.equal(h.messages.length, 1);
		if (args === "branch feat/commit") assert.match(h.messages[0], /New name: "feat\/commit"/);
	}
});

test("help, invalid arguments, missing repository/tool, clean repository, and busy agent do not start a model", async (t) => {
	for (const [options, args, expected] of [
		[{}, "help", /Usage/],
		[{}, "nonsense", /Usage/],
		[{ noRepo: true }, "only", /No Git repository/],
		[{ missing: true }, "only", /ENOENT/],
		[{ clean: true }, "only", /No changes/],
		[{ busy: true }, "only", /Wait for/],
	] as const) {
		const h = harness(t, options);
		await h.run(args);
		assert.equal(h.messages.length, 0);
		assert.match(h.notices[0], expected);
	}
});

test("rejects concurrent invocation while a menu is open, and resets after cancellation", async (t) => {
	let finish!: (choice: string | undefined) => void;
	const h = harness(t, { select: () => new Promise((resolve) => { finish = resolve; }) });
	const pending = h.run();
	await h.run("only");
	assert.match(h.notices[0], /Wait for/);
	assert.equal(h.messages.length, 0);
	finish(undefined);
	await pending;
	await h.run("only");
	assert.equal(h.messages.length, 1);
});

test("agent becoming busy during selection cancels instead of steering commit work into another task", async (t) => {
	let finish!: (choice: string | undefined) => void;
	const h = harness(t, { select: () => new Promise((resolve) => { finish = resolve; }) });
	const pending = h.run();
	h.setIdle(false);
	finish(CHOICES[0].label);
	await pending;
	assert.equal(h.calls.length, 0);
	assert.equal(h.messages.length, 0);
	assert.match(h.notices[0], /became busy/);
});
