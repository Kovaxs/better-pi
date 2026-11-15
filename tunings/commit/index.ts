import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildPrompt } from "./src/prompt.ts";
import { collectSnapshot, findRepository } from "./src/repository.ts";
import { CHOICES, parseRequest, USAGE, type CommitRequest } from "./src/request.ts";

function report(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
	else console.error(`commit: ${message}`);
}

export default function (pi: ExtensionAPI) {
	let preparing = false;

	async function prepare(args: string, ctx: ExtensionContext): Promise<string | undefined> {
		if (preparing || !ctx.isIdle()) {
			report(ctx, "Wait for the current task to finish before running /commit.", "warning");
			return;
		}
		preparing = true;
		try {
			const parsed = parseRequest(args);
			if (parsed === "help") {
				report(ctx, `${USAGE}\nNo arguments: choose interactively; without UI, commit only. Push requires an explicit choice. Uses your active model.`);
				return;
			}
			const repo = findRepository(ctx.cwd);
			if (!repo) {
				report(ctx, "No Git repository or jj workspace found.", "error");
				return;
			}

			let request: CommitRequest;
			if (parsed === "ask" && ctx.hasUI) {
				const choice = await ctx.ui.select("Commit: what to do with these changes?", CHOICES.map(({ label }) => label));
				const selected = CHOICES.find(({ label }) => label === choice);
				if (!selected) return;
				request = { action: selected.action };
			} else {
				request = parsed === "ask" ? { action: "only" } : parsed;
			}

			if (!ctx.isIdle()) {
				report(ctx, "The agent became busy; run /commit again after it finishes.", "warning");
				return;
			}
			const snapshot = await collectSnapshot(repo, (command, argv, options) => pi.exec(command, argv, options));
			if (!snapshot.hasChanges) {
				report(ctx, "No changes to commit.");
				return;
			}
			if (!ctx.isIdle()) {
				report(ctx, "The agent became busy; run /commit again after it finishes.", "warning");
				return;
			}
			return buildPrompt(request, snapshot);
		} catch (error) {
			report(ctx, error instanceof Error ? error.message : String(error), "error");
		} finally {
			preparing = false;
		}
	}

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		pi.registerCommand("commit", {
			description: "Split changes into Conventional Commits; optionally push or create a branch / bookmark",
			getArgumentCompletions: (prefix) => {
				const items = ["only", "push", "branch", "help"].filter((value) => value.startsWith(prefix));
				return items.length ? items.map((value) => ({ value, label: value })) : null;
			},
			handler: async (args, commandCtx) => {
				const prompt = await prepare(args, commandCtx);
				if (prompt) pi.sendUserMessage(prompt);
			},
		});
	});

	// Print/JSON must run inside the original prompt: sendUserMessage is fire-and-forget and can outlive the CLI invocation.
	pi.on("input", async (event, ctx) => {
		if (ctx.hasUI || !/^\/commit(?:\s|$)/.test(event.text)) return;
		const prompt = await prepare(event.text.slice("/commit".length), ctx);
		return prompt ? { action: "transform", text: prompt } : { action: "handled" };
	});
}
