# AGENTS.md

## What this repo is

**betterpi** is a collection of free, open-source tunings (extensions, prompts, skills, themes) for [pi](https://pi.dev), in the spirit of [betterclaude.dev](https://betterclaude.dev/) ([source](https://github.com/midudev/better-claude)).

Each tuning is small and does one visible thing well, like a context meter above the prompt, a `/commit` command, a narrator, or a timeline of snapshots. We are **not** porting every betterclaude plugin. Only port the ones the maintainer picks. Do not scaffold extra tunings on speculation.

## Layout

The whole repo is a single **pi package**, and each tuning lives in its own folder:

```text
betterpi/
├── AGENTS.md
├── README.md                 # table of tunings + install instructions
├── package.json              # root pi package manifest (lists every tuning)
└── tunings/
    └── <tuning-name>/        # kebab-case, e.g. context-meter
        ├── README.md         # what it does, a text mock of the UI, how it works
        ├── index.ts          # extension entry point (default export factory)
        ├── src/              # pure logic, kept separate from pi APIs (optional)
        └── test/             # node:test tests for the pure logic (optional)
```

- `package.json` has `"keywords": ["pi-package"]` and lists every tuning explicitly under `pi.extensions` (and `pi.prompts` / `pi.skills` / `pi.themes` when a tuning ships those).
- Users install everything with `pi install git:github.com/<owner>/betterpi`, or pick tunings with a settings filter such as `"extensions": ["tunings/context-meter/index.ts"]`. Document both in the root `README.md`.
- When you add, rename, or remove a tuning, update **all three**: the folder, the root `package.json` manifest, and the root `README.md` table.

## Building tunings for pi

Read the pi docs before you write extension code. Do not guess the APIs. The installed docs live in the pi install directory (`docs/` and `examples/extensions/`). Start with `docs/extensions.md`, `docs/packages.md`, and `docs/tui.md`. The exact types are in `@earendil-works/pi-coding-agent` (`extensions/types.ts`). Find the closest checked example and start from it.

Rules:

- **Entry point**: `export default function (pi: ExtensionAPI) { ... }`. Pi loads TypeScript through `jiti`, so there is no build step.
- **No side effects in the factory.** Do not start timers, watchers, processes, or sockets there. Start them in `session_start` or in the command/tool that needs them. Release them in an **idempotent** `session_shutdown` handler.
- **Mode-aware.** Extensions also load in print, JSON, and RPC modes. Guard terminal-only UI with `ctx.mode === "tui"` and dialogs with `ctx.hasUI`. Tool and event logic must still work without UI.
- **Pick the right event.** Use the "Choose an event by intent" table in `docs/extensions.md`. `agent_end` does not mean idle; use `agent_settled` for after-turn notification work (e.g. the narrator).
- **Never loop.** Any `continue: true` from `turn_end` / `agent_before_settle` must be guarded.
- **State.** Put branch-aware state in tool-result `details`, durable non-context data in `pi.appendEntry()`, and cross-session data in external storage. Rebuild from `ctx.sessionManager.getBranch()`.
- **Nested model calls** go through `ctx.modelRegistry.streamSimple()`, and their `usage` is reported in the tool result.
- **Dependencies.** Keep them minimal. Never put host packages (`@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, `typebox`) in `dependencies`. They go in `peerDependencies` with `"*"`. Anything else needs a good reason.
- **Cross-platform.** macOS first is fine, but degrade gracefully on Linux/Windows (or say so in the README). Never crash pi because an OS tool is missing.
- **Coexistence.** Tunings must work together. Don't clobber footer, status, or widget areas another tuning uses. Namespace status keys, commands, and settings by tuning name.
- **Configurable thresholds** (e.g. `warnAt`, `dangerAt`) need sensible defaults that are documented in the tuning's README.

## Style

- TypeScript, ESM, Node ≥ 22. Small files and plain functions. Keep pure logic (parsing, formatting, heuristics) out of the pi glue so it can be unit-tested.
- Write no comments that restate the code. Comment the *why* and any pi quirk you rely on.
- The README for each tuning follows the betterclaude tone: one sentence on what the user sees, a text mock of the UI, then a short **How it works** section that names the pi events/APIs used.

## Testing

- Pure logic: `node --test "tunings/*/test/*.test.ts"` (or `.js`). Add tests for anything non-trivial.
- Manual run of one tuning: `pi -e ./tunings/<name>/index.ts`. Load the whole package with `pi -e .`.
- Before you call something done, load it in pi at least once and check it in interactive mode **and** in print mode (`pi -p "hi" -e ./tunings/<name>/index.ts`), so a missing UI does not throw.

## Version control: jj (Jujutsu)

This repo uses **jj** on top of a git backend. **Do not run mutating `git` commands** (`git add`, `git commit`, `git checkout`, `git rebase`, `git stash`, …). They confuse jj's view of the repo. Read-only git is fine, but prefer jj.

- The working copy *is* a commit (`@`) and gets snapshotted on its own. There is no staging area and no `add`.
- Inspect: `jj status`, `jj log`, `jj diff`, `jj show <rev>`.
- Describe the current change: `jj describe -m "feat(context-meter): show fill above the prompt"`.
- Finish a change and start a new one: `jj commit -m "<message>"` (same as `describe` + `new`).
- Split unrelated work: `jj split` (interactive, so avoid it in agent runs; prefer `jj split <paths>` or keep each change focused from the start).
- Undo mistakes: `jj undo` / `jj op log`.
- Publish: `jj bookmark set main -r @-` then `jj git push`. **Only push when the user asks.**
- Commit messages: Conventional Commits, scoped by tuning name (`feat(narrator): …`, `fix(commit): …`, `docs: …`, `chore: …`). One logical change per commit. No AI attribution trailers.
- Never commit secrets, API keys, or local settings (`.pi/settings.json` with personal paths, `.env`).
