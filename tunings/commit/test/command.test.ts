import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerCommit } from "../command.ts";
import { CHOICES } from "../src/request.ts";

const activeModel = { provider: "default", id: "active" };
const shippedModel = { provider: "opencode-go", id: "claude-haiku-5-5" };
const commitModel = { provider: "custom", id: "vendor/fast" };
const configuredModel = JSON.stringify({ defaultModel: "custom/vendor/fast" });

function harness(t: test.TestContext, options: { hasUI?: boolean; mode?: ExtensionContext["mode"]; clean?: boolean; missing?: boolean; noRepo?: boolean; busy?: boolean; choice?: string; select?: () => Promise<string | undefined>; settings?: string; unauthorized?: boolean; alreadySelected?: boolean } = {}) {
	const root = mkdtempSync(join(tmpdir(), "betterpi-commit-command-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	if (!options.noRepo) writeFileSync(join(root, ".git"), "gitdir: /fixture");
	const settingsPath = join(root, "settings.json");
	if (options.settings !== undefined) writeFileSync(settingsPath, options.settings);
	let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
	let delivery: Promise<void> | undefined;
	const events = new Map<string, (event: any, ctx: ExtensionContext) => any>();
	const messages: string[] = [];
	const notices: string[] = [];
	const calls: string[][] = [];
	let selections = 0;
	let idle = !options.busy;
	let model = options.alreadySelected ? commitModel : activeModel;
	let thinkingLevel = "high";
	const modelChanges: typeof activeModel[] = [];
	const ctx = {
		get model() { return model; },
		get thinkingLevel() { return thinkingLevel; },
		modelRegistry: {
			find: (provider: string, id: string) => [activeModel, shippedModel, commitModel].find((m) => m.provider === provider && m.id === id),
		},
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
		setModel: async (next: typeof activeModel) => {
			if (options.unauthorized) return false;
			modelChanges.push(next);
			model = next;
			thinkingLevel = "off";
			return true;
		},
		setThinkingLevel: (next: string) => { thinkingLevel = next; },
		sendUserMessage: (message: string) => {
			delivery = input(message, "extension").then(() => { messages.push(message); });
		},
	} as unknown as ExtensionAPI;
	registerCommit(pi, settingsPath);
	events.get("session_start")!({ reason: "startup" }, ctx);
	async function input(text: string, source = "interactive") {
		const result = await events.get("input")!({ text, source }, ctx);
		if (result?.action === "transform") messages.push(result.text);
		return result;
	}
	return {
		run: async (args = "") => {
			if (!handler) return input(`/commit ${args}`);
			await handler(args, ctx);
			await delivery;
		},
		input, messages, notices, calls, modelChanges,
		model: () => model,
		thinkingLevel: () => thinkingLevel,
		setModel: (next: typeof activeModel) => { model = next; },
		settle: (aborted = false) => events.get("agent_settled")!({ aborted }, ctx),
		shutdown: () => events.get("session_shutdown")!({ reason: "quit" }, ctx),
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
		assert.deepEqual(h.modelChanges, [shippedModel]);
	}
});

test("cancelled menus never inspect or mutate the repository or start a task", async (t) => {
	const h = harness(t, { settings: configuredModel });
	await h.run();
	assert.equal(h.messages.length, 0);
	assert.equal(h.calls.length, 0);
	assert.deepEqual(h.modelChanges, []);
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
		const h = harness(t, { settings: configuredModel, ...options });
		await h.run(args);
		assert.equal(h.messages.length, 0);
		assert.match(h.notices[0], expected);
		assert.deepEqual(h.modelChanges, []);
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

test("missing or empty settings use Claude Haiku 5.5 on OpenCode Go", async (t) => {
	for (const settings of [undefined, "{}"]) {
		const h = harness(t, { settings });
		await h.run("only");
		assert.equal(h.messages.length, 1);
		assert.equal(h.model(), shippedModel);
		await h.settle();
		assert.equal(h.model(), activeModel);
	}
});

test("a null default model keeps the active model", async (t) => {
	const h = harness(t, { settings: '{"defaultModel":null}' });
	await h.run("only");
	await h.settle();
	assert.equal(h.messages.length, 1);
	assert.equal(h.model(), activeModel);
	assert.deepEqual(h.modelChanges, []);
});

test("the configured model is scoped to the commit run in each mode", async (t) => {
	for (const mode of ["tui", "rpc", "print", "json"] as const) {
		const h = harness(t, { mode, hasUI: mode === "tui" || mode === "rpc", settings: configuredModel });
		await h.run("only");
		assert.equal(h.messages.length, 1);
		assert.equal(h.model(), commitModel);
		assert.equal(h.thinkingLevel(), "off");
		await h.settle(mode === "tui");
		assert.equal(h.model(), activeModel);
		assert.equal(h.thinkingLevel(), "high");
		assert.deepEqual(h.modelChanges, [commitModel, activeModel]);
	}
});

test("an already selected commit model isn't switched or restored", async (t) => {
	const h = harness(t, { settings: configuredModel, alreadySelected: true });
	await h.run("only");
	await h.settle();
	assert.equal(h.messages.length, 1);
	assert.deepEqual(h.modelChanges, []);
});

test("invalid, unknown, and unauthenticated defaults stop before sending a prompt", async (t) => {
	for (const [settings, unauthorized, expected] of [
		["{", false, /Invalid JSON/],
		['{"defaultModel":"fast"}', false, /provider\/model-id/],
		['{"defaultModel":"custom/missing"}', false, /not found/],
		[configuredModel, true, /No authentication/],
	] as const) {
		const h = harness(t, { settings, unauthorized });
		await h.run("only");
		assert.match(h.notices[0], expected);
		assert.equal(h.messages.length, 0);
		assert.deepEqual(h.modelChanges, []);
	}
});

test("restores on shutdown or the next idle input if the turn never starts", async (t) => {
	for (const recover of [(h: ReturnType<typeof harness>) => h.shutdown(), (h: ReturnType<typeof harness>) => h.input("hello")]) {
		const h = harness(t, { settings: configuredModel });
		await h.run("only");
		await recover(h);
		assert.equal(h.model(), activeModel);
	}
});

test("restoring does not overwrite a newer model selection", async (t) => {
	const h = harness(t, { settings: configuredModel });
	await h.run("only");
	const newer = { provider: "other", id: "newer" };
	h.setModel(newer);
	await h.settle();
	assert.equal(h.model(), newer);
	assert.deepEqual(h.modelChanges, [commitModel]);
});
