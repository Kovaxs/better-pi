import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildPrompt } from "./src/prompt.ts";
import { collectSnapshot, findRepository } from "./src/repository.ts";
import { CHOICES, parseRequest, USAGE, type CommitRequest } from "./src/request.ts";
import { DEFAULT_MODEL, loadDefaultModel } from "./src/settings.ts";

type Model = NonNullable<ExtensionContext["model"]>;

function sameModel(active: Model | undefined, target: Pick<Model, "provider" | "id">): boolean {
	return active?.provider === target.provider && active.id === target.id;
}

function report(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
	else console.error(`commit: ${message}`);
}

export function registerCommit(pi: ExtensionAPI, settingsPath: string) {
	let preparing = false;
	let restoring = false;
	let pendingRestore: { previous: Model; selected: Model; thinking: ExtensionContext["thinkingLevel"]; prompt?: string } | undefined;

	async function restoreModel(ctx: ExtensionContext): Promise<void> {
		const restore = pendingRestore;
		pendingRestore = undefined;
		if (!restore || !sameModel(ctx.model, restore.selected)) return;
		restoring = true;
		try {
			if (!await pi.setModel(restore.previous)) throw new Error("authentication is unavailable");
			pi.setThinkingLevel(restore.thinking);
		} catch (error) {
			report(ctx, `Could not restore ${restore.previous.provider}/${restore.previous.id}: ${error instanceof Error ? error.message : String(error)}`, "warning");
		} finally {
			restoring = false;
		}
	}

	pi.on("agent_settled", (_event, ctx) => restoreModel(ctx));
	pi.on("session_shutdown", (_event, ctx) => restoreModel(ctx));

	async function prepare(args: string, ctx: ExtensionContext): Promise<string | undefined> {
		if (preparing || restoring || !ctx.isIdle()) {
			report(ctx, "Wait for the current task to finish before running /commit.", "warning");
			return;
		}
		preparing = true;
		try {
			const parsed = parseRequest(args);
			if (parsed === "help") {
				report(ctx, `${USAGE}\nNo arguments: choose interactively; without UI, commit only. Push requires an explicit choice.\nDefault model: ${DEFAULT_MODEL}. Set "defaultModel" in ${settingsPath} to override it, or use null to keep your active model.`);
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
			const model = await loadDefaultModel(settingsPath);
			if (!ctx.isIdle()) {
				report(ctx, "The agent became busy; run /commit again after it finishes.", "warning");
				return;
			}
			const prompt = buildPrompt(request, snapshot);
			if (model && !sameModel(ctx.model, model)) {
				const ref = `${model.provider}/${model.id}`;
				const selected = ctx.modelRegistry.find(model.provider, model.id);
				if (!selected) throw new Error(`Commit model ${ref} not found. Check ${settingsPath} or run pi --list-models.`);
				const previous = ctx.model;
				const thinking = ctx.thinkingLevel;
				if (!await pi.setModel(selected)) throw new Error(`No authentication for commit model ${ref}.`);
				if (previous) pendingRestore = { previous, selected, thinking, prompt: ctx.hasUI ? prompt : undefined };
				if (!ctx.isIdle()) {
					await restoreModel(ctx);
					report(ctx, "The agent became busy; run /commit again after it finishes.", "warning");
					return;
				}
			}
			return prompt;
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
				if (pendingRestore && commandCtx.isIdle()) await restoreModel(commandCtx);
				const prompt = await prepare(args, commandCtx);
				if (prompt) pi.sendUserMessage(prompt);
			},
		});
	});

	pi.on("input", async (event, ctx) => {
		// Recover if the commit prompt was intercepted or failed before starting an agent run.
		if (pendingRestore && ctx.isIdle()) {
			if (event.source === "extension" && event.text === pendingRestore.prompt) {
				pendingRestore.prompt = undefined;
				return;
			}
			await restoreModel(ctx);
		}
		// Print/JSON runs inside the awaited prompt; fire-and-forget sendUserMessage can outlive the CLI.
		if (ctx.hasUI || !/^\/commit(?:\s|$)/.test(event.text)) return;
		const prompt = await prepare(event.text.slice("/commit".length), ctx);
		return prompt ? { action: "transform", text: prompt } : { action: "handled" };
	});
}
