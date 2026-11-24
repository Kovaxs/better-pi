export type CommitAction = "only" | "push" | "branch";

export interface CommitRequest {
	action: CommitAction;
	branch?: string;
}

export const USAGE = "Usage: /commit [only|push|branch [name]|help]";

export const CHOICES = [
	{ action: "push", label: "Commit + push" },
	{ action: "only", label: "Commit only" },
	{ action: "branch", label: "Commit on a new branch / bookmark + push" },
] as const;

export function validBranchName(name: string): boolean {
	return (
		name !== "HEAD" &&
		!name.includes("..") &&
		name.split("/").every((part) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) && !part.endsWith(".") && !part.endsWith(".lock"))
	);
}

export function parseRequest(args: string): CommitRequest | "ask" | "help" {
	const parts = args.trim().split(/\s+/);
	if (!parts[0]) return "ask";
	if ((parts[0] === "help" || parts[0] === "--help") && parts.length === 1) return "help";
	if ((parts[0] === "only" || parts[0] === "push") && parts.length === 1) return { action: parts[0] };
	if (parts[0] === "branch" && parts.length <= 2) {
		if (parts[1] && !validBranchName(parts[1])) throw new Error("Invalid branch / bookmark name. Use a name such as feat/side-panel.");
		return parts[1] ? { action: "branch", branch: parts[1] } : { action: "branch" };
	}
	throw new Error(USAGE);
}
