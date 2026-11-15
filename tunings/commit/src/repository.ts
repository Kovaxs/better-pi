import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface Repository {
	kind: "git" | "jj";
	root: string;
}

export interface Snapshot extends Repository {
	location: string;
	status: string;
	diff: string;
	recent: string;
	hasChanges: boolean;
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
	truncated?: boolean;
}

export type Exec = (command: string, args: string[], options: { cwd: string; timeout: number; maxBuffer: number }) => Promise<ExecResult>;

export function findRepository(cwd: string): Repository | undefined {
	let root = resolve(cwd);
	while (true) {
		if (existsSync(join(root, ".jj"))) return { kind: "jj", root };
		if (existsSync(join(root, ".git"))) return { kind: "git", root };
		const parent = dirname(root);
		if (parent === root) return undefined;
		root = parent;
	}
}

const CONTEXT_LIMIT = 12_000;

function bounded(text: string): string {
	const trimmed = text.trimEnd();
	return trimmed.length <= CONTEXT_LIMIT
		? trimmed
		: trimmed.slice(0, CONTEXT_LIMIT) + "\n[Summary truncated; inspect the remaining paths before committing.]";
}

export async function collectSnapshot(repo: Repository, exec: Exec): Promise<Snapshot> {
	async function run(args: string[]): Promise<string> {
		const globalArgs = repo.kind === "jj" ? ["--color", "never", "--no-pager"] : ["--no-pager"];
		const result = await exec(repo.kind, [...globalArgs, ...args], { cwd: repo.root, timeout: 10_000, maxBuffer: 1024 * 1024 });
		if (result.code !== 0 || result.killed || result.truncated) {
			throw new Error(`${repo.kind} ${args[0]} failed: ${bounded(result.stderr) || "command failed, timed out, or exceeded its output limit"}`);
		}
		return result.stdout;
	}

	if (repo.kind === "jj") {
		// Run serially: jj inspection also snapshots the workspace.
		const status = await run(["status"]);
		const summary = await run(["diff", "--summary"]);
		const location = await run(["log", "--no-graph", "-r", "@ | @-", "-T", 'change_id.short() ++ " " ++ bookmarks ++ " " ++ description.first_line() ++ "\\n"']);
		const recent = await run(["log", "--no-graph", "-r", "ancestors(@-, 10)", "-T", 'commit_id.short() ++ " " ++ description.first_line() ++ "\\n"']);
		return { ...repo, location: bounded(location), status: bounded(status), diff: bounded(summary), recent: bounded(recent), hasChanges: summary.trim().length > 0 };
	}

	const status = await run(["status", "--porcelain=v1", "--untracked-files=all"]);
	const location = await run(["branch", "--show-current"]);
	const unstaged = await run(["diff", "--stat", "--no-ext-diff"]);
	const staged = await run(["diff", "--cached", "--stat", "--no-ext-diff"]);
	// --all also succeeds in an unborn repository with no refs.
	const recent = await run(["log", "--all", "-10", "--oneline"]);
	return {
		...repo,
		location: bounded(location) || "(detached HEAD)",
		status: bounded(status),
		diff: bounded(`Unstaged:\n${unstaged}\nStaged:\n${staged}`),
		recent: bounded(recent) || "(No commits yet)",
		hasChanges: status.trim().length > 0,
	};
}
