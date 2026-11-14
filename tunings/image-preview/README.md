# Image Preview

Hover an image chip above the prompt to preview it; click to open it in your system viewer.

```text
screenshot.png
            [image preview]
Click chip to open · /image-preview for keyboard access
Draft: [Image #1] [Image #2] · hover to preview · click to open
────────────────────────────────────────────────────────────
❯ What is wrong here? /tmp/pi-clipboard-….png
```

Paste an image with pi's clipboard shortcut, or type a local PNG, JPEG, GIF, or WebP path. Quoted paths, escaped spaces, `@path`, and `~/path` work. The row updates within 300 ms. With no draft images, it shows up to six recent images from the current branch. Chip numbers belong to this row, not pi's transcript numbering.

- **Fullscreen:** hover a chip for a non-focus-stealing preview above the row; moving off, typing, scrolling, or resizing closes it. Click the chip to open the original.
- **Keyboard (both TUI modes):** `Ctrl+Shift+I` previews without submitting or replacing your draft. `/image-preview` picks an image from the draft/current branch; Enter opens the viewer, Escape closes. `/image-preview open` skips the terminal preview. Terminals that cannot distinguish Ctrl+Shift+I can use the command.
- **Viewer:** Preview on macOS, Explorer on Windows/WSL, `xdg-open` on Linux. Missing OS utilities report a warning instead of breaking pi. Viewer launches are disabled over SSH.

Try it:

```sh
pi -e ./tunings/image-preview/index.ts
```

## How it works

On `session_start`, a namespaced `ctx.ui.setWidget("image-preview", …)` supplies the chip row. A session-scoped timer reads `ctx.ui.getEditorText()`: pi pastes clipboard images as temporary file paths, without an extension edit event. Only existing draft files get chips. `message_end`, `agent_settled`, and `session_tree` rebuild sent-image references from `ctx.sessionManager.getBranch()`, including persisted image content blocks.

The widget's normalized mouse events open a `tui.showOverlay()` preview with `nonCapturing: true`. A `ctx.ui.onTerminalInput()` listener closes it on pointer departure or typing; `ctx.ui.custom()` supplies the keyboard preview. Images use pi-tui's `Image` component and native Kitty/iTerm2 protocols; non-PNG images are converted with pi's `convertToPng()` when Kitty requires it. No editor, footer, or other extension widget is replaced. Print, JSON, and RPC modes are untouched.

Images are read only on preview/open, capped at 20 MiB. Embedded attachments are written to a private temporary directory only when explicitly opened externally. `session_shutdown` removes those files, listeners, timers, and hover overlays. Original files and pi clipboard files are never deleted.

## Differences from the Claude Code plugin

This is a native adaptation of [betterclaude's image-preview](https://github.com/midudev/better-claude/tree/main/plugins/image-preview), not a patch to pi.

- Hover targets live in the chip row, **not** over pi's existing editor/transcript text. Older branch images remain accessible through the command.
- Hover needs fullscreen mode and terminal/multiplexer mouse-motion support. Regular mode uses the keyboard command.
- Terminals without an image protocol show metadata instead of pixels; use the system viewer. There is no external floating hover window or colored-block renderer.
- Only local raster images are supported; URLs are not fetched, and SVGs are not executed. Deleted clipboard files cannot be recovered from a path-only prompt; persisted image attachments still work.
- Previews do not attach images to prompts or change what the model receives. Polling tracks path edits, not subsequent file creation at an unchanged draft path.
