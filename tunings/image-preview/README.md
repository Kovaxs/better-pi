# Image Preview

Paste an image to get an `[Image #1]` marker; hover it to preview, or click to open the original.

```text
screenshot.png
            [image preview]
Click image chip to open original · /image-preview
Draft: [Image #1] [Image #2] · hover to preview · click to open
────────────────────────────────────────────────────────────
❯ What is wrong here? [Image #1]
```

Paste with pi's clipboard shortcut. Clipboard image paths and pasted local PNG, JPEG, GIF, or WebP paths become compact markers in the editor. Quoted paths, escaped spaces, unquoted Finder paths with spaces, `@path`, and `~/path` work. Manually typed paths still get chips above the prompt; that row updates within 300 ms.

- **Fullscreen:** hover either an editor marker or a chip above the prompt. Moving off, typing, scrolling, or resizing closes the preview. Click to open the original.
- **WezTerm:** uses real inline image pixels via its iTerm2 protocol, not colored blocks. Detection uses `TERM_PROGRAM` / `WEZTERM_PANE`. If tmux hides those variables, add `--image-preview-terminal wezterm` when starting pi. Previews are larger (up to 120 columns / 30 rows), with the original aspect ratio preserved.
- **tmux:** enable `set -g mouse on` and `set -g allow-passthrough on`. WezTerm previews use DCS passthrough without changing pi’s global graphics settings. Large preview copies are bounded to fit tmux’s input buffer; click always opens the untouched original. Other terminals without graphics use the coarse block fallback.
- **screen / Zellij:** passive mouse reporting is enabled and restored on shutdown; the multiplexer must forward mouse events. WezTerm graphics passthrough is implemented for tmux, not screen/Zellij.
- **Keyboard (both TUI modes):** `Ctrl+Shift+I` previews without submitting your draft. `/image-preview` picks an image from the draft/current branch; Enter opens the viewer, Escape closes. `/image-preview open` skips the terminal preview. Terminals that cannot distinguish Ctrl+Shift+I can use the command.
- **Viewer:** Preview on macOS, Explorer on Windows/WSL, `xdg-open` on Linux. Missing OS utilities report a warning; viewer launches are disabled over SSH.

With no draft images, the row shows up to six recent branch images. Pasted marker numbers remain stable for undo/history; recent-row numbers are local to that row. Submitting expands markers back to their original paths, so the model and saved transcript still receive the real filenames.

Try it:

```sh
pi -e ./tunings/image-preview/index.ts
```

## How it works

On `session_start`, a wrapper around the previous editor (or pi's `CustomEditor`) intercepts `insertTextAtCursor()` to display pasted image paths as markers. It forwards focus, editing, autocomplete, and application actions. `getExpandedText()` and submit/change callbacks expand markers, preserving pi's original prompt content and allowing undo/history to keep working. Editor replacement on reload/shutdown also preserves expanded paths.

A namespaced `ctx.ui.setWidget("image-preview", …)` supplies the chip row. A session timer reads `ctx.ui.getEditorText()`, since clipboard insertion is asynchronous and has no extension edit event. `message_end`, `agent_settled`, and `session_tree` rebuild sent-image references from `ctx.sessionManager.getBranch()`, including persisted image content blocks.

Normalized mouse events open a `tui.showOverlay()` preview with `nonCapturing: true`. `ctx.ui.onTerminalInput()` closes it on pointer departure or typing; `ctx.ui.custom()` supplies keyboard access. In fullscreen multiplexers, the tuning requests DECSET 1003 (all-motion) because pi normally requests button-motion only.

WezTerm gets a dedicated iTerm2 image renderer with cursor preservation and optional tmux DCS framing. Its escape sequences are checked against pi’s actual overlay compositor, including older ANSI parsers. This bypasses pi’s conservative tmux image detection without overriding any global capabilities. Other terminals use pi-tui’s `Image` and native Kitty/iTerm2 protocols when available. Otherwise PNG pixels are drawn as true-color half blocks; JPEG/GIF/WebP are first converted with pi's `convertToPng()`. The dependency-free fallback supports non-interlaced 8-bit PNGs, including palettes/transparency, capped at 16 million pixels. Unusual encodings fall back to metadata and the system viewer. No global graphics capabilities are overridden.

Images are read only on preview/open, capped at 20 MiB. Embedded attachments are written to a private temporary directory only when explicitly opened externally. `session_shutdown` restores mouse reporting and the prior editor, removes temporary files, and stops listeners/timers/overlays. Original and pi clipboard files are never deleted. Print, JSON, and RPC modes are untouched.

## Limits

- Sent transcript text is not a hover target; use the recent-image row or command.
- Hover requires fullscreen mode and mouse-motion forwarding. Regular mode uses keyboard access.
- The non-graphics block fallback shows layout, not legible screenshot text; WezTerm does not use it when detected and passthrough is enabled. There is no separate floating OS hover window.
- Only local raster images are supported; URLs are not fetched and SVGs are not executed. Deleted clipboard files cannot be recovered from a path-only prompt; persisted image attachments still work.
- This tuning does not attach images to prompts or change what the model receives. Polling tracks path edits, not subsequent file creation at an unchanged draft path.

The native rendering/compositor smoke check runs inside pi (no model request):

```sh
pi --no-extensions -e ./tunings/image-preview/test/render-smoke.ts -p /image-preview-render-smoke
```

A native adaptation of [betterclaude's image-preview](https://github.com/midudev/better-claude/tree/main/plugins/image-preview), not a patch to pi.
