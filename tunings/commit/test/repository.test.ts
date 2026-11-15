import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectSnapshot, findRepository, type Exec, type ExecResult } from "../src/repository.ts";

function fixture(t: test.TestContext): string {
	const root = mkdtempSync(join(tmpdir(), "betterpi-commit-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

test("finds nearest repository, prefers colocated jj, supports Git worktree files", (t) => {
	const root = fixture(t);
	assert.equal(findRepository(root), undefined);
	writeFileSync(join(root, ".git"), "gitdir: /a/worktree");
	const nested = join(root, "src", "nested");
	mkdirSync(nested, { recursive: true });
	assert.deepEqual(findRepository(nested), { kind: "git", root });
	mkdirSync(join(root, ".jj"));
	assert.deepEqual(findRepository(nested), { kind: "jj", root });
	mkdirSync(join(nested, ".git"));
	assert.deepEqual(findRepository(nested), { kind: "git", root: nested });
});

function fakeExec(outputs: string[], calls: { command: string; args: string[] }[]): Exec {
	return async (command, args, options) => {
		calls.push({ command, args });
		assert.equal(options.cwd, "/repo");
		assert.equal(options.timeout, 10_000);
		assert.equal(options.maxBuffer, 1024 * 1024);
		return { code: 0, stdout: outputs.shift() ?? "", stderr: "" };
	};
}

test("Git snapshot includes staged, unstaged, untracked, and history without loading contents", async () => {
	const calls: { command: string; args: string[] }[] = [];
	const snapshot = await collectSnapshot({ kind: "git", root: "/repo" }, fakeExec([
		" M src/a.ts\nA  src/b.ts\n?? new.ts\n", "main\n", "src/a.ts | 1 +\n", "src/b.ts | 1 +\n", "abcd feat: start\n",
	], calls));
	assert.equal(snapshot.hasChanges, true);
	assert.equal(snapshot.location, "main");
	assert.ok(snapshot.status.startsWith(" M"));
	assert.match(snapshot.diff, /Unstaged:[\s\S]*a.ts[\s\S]*Staged:[\s\S]*b.ts/);
	assert.match(snapshot.status, /\?\? new.ts/);
	assert.deepEqual(calls.map(({ args }) => args), [
		["--no-pager", "status", "--porcelain=v1", "--untracked-files=all"],
		["--no-pager", "branch", "--show-current"],
		["--no-pager", "diff", "--stat", "--no-ext-diff"],
		["--no-pager", "diff", "--cached", "--stat", "--no-ext-diff"],
		["--no-pager", "log", "--all", "-10", "--oneline"],
	]);
});

test("Git clean, unborn, and detached snapshots do not require HEAD", async () => {
	const repo = { kind: "git", root: "/repo" } as const;
	const clean = await collectSnapshot(repo, fakeExec(["", "main\n", "", "", ""], []));
	assert.equal(clean.hasChanges, false);
	const unborn = await collectSnapshot(repo, fakeExec(["?? new.ts\n", "main\n", "", "", ""], []));
	assert.equal(unborn.hasChanges, true);
	assert.equal(unborn.recent, "(No commits yet)");
	const detached = await collectSnapshot(repo, fakeExec([" M a\n", "", "", "", ""], []));
	assert.equal(detached.location, "(detached HEAD)");
});

test("jj uses only jj and derives changes from diff, not verbose status prose", async () => {
	const calls: { command: string; args: string[] }[] = [];
	const repo = { kind: "jj", root: "/repo" } as const;
	const clean = await collectSnapshot(repo, fakeExec(["The working copy has no changes.\n", "", "abcd main\n", "history\n"], calls));
	assert.equal(clean.hasChanges, false);
	assert.ok(calls.every(({ command, args }) => command === "jj" && args[0] === "--color" && args.includes("--no-pager")));
	const dirty = await collectSnapshot(repo, fakeExec(["status", "A src/a.ts\n", "abcd feat/commit\n", "history"], []));
	assert.equal(dirty.hasChanges, true);
	assert.equal(dirty.location, "abcd feat/commit");
});

test("bounds large summaries with a visible marker", async () => {
	const snapshot = await collectSnapshot({ kind: "git", root: "/repo" }, fakeExec([" M " + "x".repeat(20_000), "main", "", "", ""], []));
	assert.match(snapshot.status, /Summary truncated/);
	assert.ok(snapshot.status.length < 12_200);
});

test("fails closed for missing executables, failed commands, timeouts, and output caps", async () => {
	const repo = { kind: "jj", root: "/repo" } as const;
	const missing: Exec = async () => { throw new Error("spawn jj ENOENT"); };
	await assert.rejects(collectSnapshot(repo, missing), /ENOENT/);
	for (const result of [
		{ code: 1, stderr: "not a repository" },
		{ code: 0, killed: true },
		{ code: 0, truncated: true },
	]) {
		const exec: Exec = async () => ({ stdout: "", stderr: "", ...result }) as ExecResult;
		await assert.rejects(collectSnapshot(repo, exec), /jj status failed/);
	}
});
