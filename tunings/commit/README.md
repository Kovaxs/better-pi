# Commit

`/commit` asks whether to push, stay local, or start a new branch, then asks pi to split your changes into Conventional Commits.

```text
❯ /commit

  Commit: what to do with these changes?
  ❯ Commit + push
    Commit only
    Commit on a new branch / bookmark + push

  feat(side-panel): add keyboard navigation
  test(side-panel): cover focus restoration
  feat/side-panel · pushed to origin
```

| Choice | What pi is asked to do |
| --- | --- |
| **Commit + push** | Commit on the current branch / bookmark, including main, then push to origin. |
| **Commit only** | Commit locally without any remote operations. |
| **New branch / bookmark + push** | Pick an unused `type/short-summary` name, commit there, then push only that branch / bookmark. |

Escape cancels without starting a model turn. To skip the menu:

```text
/commit only
/commit push
/commit branch
/commit branch feat/side-panel
/commit help
```

Explicit names use ASCII letters, digits, dots, underscores, hyphens, and slashes, with Git-compatible restrictions. Without a name, pi derives one from the changes.

## Set a default model

`/commit` defaults to **Claude Haiku 5.5 on OpenCode Go** (`opencode-go/claude-haiku-5-5`). No settings file is needed if OpenCode Go is already configured in Pi.

To override the default, create `~/.pi/agent/commit/settings.json` (or `commit/settings.json` under `PI_CODING_AGENT_DIR` if you set it):

```json
{
  "defaultModel": "anthropic/claude-haiku-4-5"
}
```

Use an authenticated `provider/model-id` from `pi --list-models`, or set `"defaultModel": null` to use your active model. Removing the field or file restores the shipped default. The setting is read on each commit attempt; no restart is needed. An invalid or unavailable model stops the command rather than sending repository context to a different model.

This works in TUI, RPC, print, and JSON modes. Pi restores the previous model and thinking level when the commit run settles, unless the model was changed in the meantime. If there was no active model to restore, the commit model stays selected.

## How it works

In `session_start`, UI sessions register a native `pi.registerCommand("commit")`. It uses `ctx.ui.select()`, collects repository context through bounded, argument-array `pi.exec()` calls, and starts a normal agent task with `pi.sendUserMessage()`. Print / JSON sessions instead expand `/commit` through the `input` event, keeping the task inside the original, awaited prompt so the CLI cannot exit early. Both paths refuse to start while the agent is busy. Clean repositories don't start a model turn. No timers or persistent UI areas are installed.

The nearest repository marker wins; jj takes precedence over Git in a colocated workspace. The snapshot includes the current branch / nearby bookmarks, status, diff **summaries**, and recent commit subjects. It deliberately does not preload file contents, which could contain secrets. Each command has a 10-second timeout and a 1 MiB output cap; each snapshot section is capped at 12,000 characters. Missing executables and inspection failures are reported without starting the task.

The task asks pi to inspect eligible diffs, group changes, use imperative Conventional Commit subjects under 72 characters, respect repository language instructions (English by default), and omit AI attribution. It instructs pi to exclude `.env*`, credentials, keys, secrets, and personal settings; check the staged diff before each Git commit; preserve working files; and stop on conflicts, hook failures, or push errors. Git repositories with no commits yet are supported; detached HEAD requires the new-branch workflow.

In jj workspaces the task uses `jj commit -m … -- <paths>` for each group, keeps excluded files in the working-copy change, moves only the chosen bookmark to the last finalized revision, and uses `jj git push --bookmark …`. It never asks for mutating Git commands in a jj workspace. If the current bookmark is ambiguous, pi is asked to stop rather than guess.

Like the [original better-claude command](https://github.com/midudev/better-claude/tree/main/plugins/commit), this is a **prompt-driven workflow**, not a deterministic commit engine or a security sandbox. Grouping, file inspection, secret checks, and mutations are performed by the model through your existing tools and permission extensions. It does not restrict or replace those tools. Review its actions as you would any other agent task.

### Differences from the original

- Ships with **Claude Haiku 5.5 on OpenCode Go** as the default, but you can choose another provider or use your active Pi model.
- Supports both Git and jj, including jj workspaces backed by Git.
- **Without UI (print / JSON), bare `/commit` means commit only**, never implicit push. RPC uses the same selection dialog as the TUI; a dismissed/unavailable dialog cancels. Explicit `push` or `branch` authorizes pushing in any mode.
- Uses pi's normal session context and tools, honoring repository instructions rather than replacing them.

## Try it

From this repository:

```sh
pi -e ./tunings/commit/index.ts
pi -p "/commit only" -e ./tunings/commit/index.ts
```

The second command can create real commits. To check loading without committing, use `pi -p "hi" -e ./tunings/commit/index.ts`.

To install just this tuning, use the [root installation instructions](../../README.md#install) with `"extensions": ["tunings/commit/index.ts"]`.

Requires Node ≥ 22 and Git or jj on `PATH`. No additional dependencies; macOS, Linux, and Windows use the same APIs.
