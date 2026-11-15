import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectSnapshot, findRepository, type Exec } from "../src/repository.ts";

const hasJjAndGit = spawnSync("jj", ["--version"]).status === 0 && spawnSync("git", ["--version"]).status === 0;
const exec: Exec = async (command, args, options) => {
	const result = spawnSync(command, args, { ...options, encoding: "utf8" });
	if (result.error) throw result.error;
	return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? 1 };
};

function fixture(t: test.TestContext): { parent: string; root: string } {
	const parent = mkdtempSync(join(tmpdir(), "betterpi-commit-integration-"));
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const root = join(parent, "repo");
	// jj initializes the disposable Git backend; tests never mutate it with git.
	execFileSync("jj", ["git", "init", "--colocate", root], { stdio: "pipe" });
	return { parent, root };
}

test("real jj snapshots detect clean and changed workspaces", { skip: !hasJjAndGit }, async (t) => {
	const { root } = fixture(t);
	const repo = findRepository(root)!;
	assert.equal(repo.kind, "jj");
	assert.equal((await collectSnapshot(repo, exec)).hasChanges, false);
	writeFileSync(join(root, "README.md"), "# Fixture\n");
	const snapshot = await collectSnapshot(repo, exec);
	assert.equal(snapshot.hasChanges, true);
	assert.match(snapshot.diff, /README.md/);
});

test("real unborn Git snapshot works without HEAD, including untracked paths with spaces", { skip: !hasJjAndGit }, async (t) => {
	const { parent, root } = fixture(t);
	renameSync(join(root, ".jj"), join(parent, "jj-metadata"));
	rmSync(join(root, ".git", "refs", "jj"), { recursive: true, force: true });
	const repo = findRepository(root)!;
	assert.equal(repo.kind, "git");
	assert.equal((await collectSnapshot(repo, exec)).hasChanges, false);
	writeFileSync(join(root, "new file.md"), "# Fixture\n");
	const snapshot = await collectSnapshot(repo, exec);
	assert.equal(snapshot.hasChanges, true);
	assert.equal(snapshot.recent, "(No commits yet)");
	assert.match(snapshot.status, /new file.md/);
});
