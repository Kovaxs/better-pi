# sub-meter

See subscription usage windows and reset times above the prompt.

```text
 5h ━━━━━━──── 58% ↻ 3h 12m   week ━━━─────── 31% ↻ 4d 3h
╭────────────────────────────────────────────────────────╮
│ › Ask pi anything…                                     │
╰────────────────────────────────────────────────────────╯
```

The line switches between available windows every eight seconds by default. Missing windows stay missing; an expired window shows `0%` until the next refresh.

## Providers

| Provider | Authentication | Windows shown |
|---|---|---|
| `openai-codex` | ChatGPT OAuth | Five-hour and weekly rate limits, from response headers or ChatGPT's usage endpoint |
| `opencode-go` | OpenCode API key | Rolling, weekly, and monthly usage reported by OpenCode Go |

API-key Codex sessions and other providers do not display a subscription meter. The undocumented ChatGPT endpoint is used only when fresh response headers are unavailable. Requests always use the providers' fixed usage origins, never a model's configured base URL.

## Command

```text
/sub-meter                 Show provider, auth, windows, update time, and safe error details
/sub-meter refresh         Fetch usage now
/sub-meter rotate          Rotate through available windows
/sub-meter both            Show all available windows on one line
/sub-meter session         Show the session window (or another available window)
/sub-meter week            Show the weekly window (or another available window)
```

On narrow terminals, bars are dropped first, then reset times, then the whole line. Colors change at 75% and 90% by default.

## Settings

Settings live in `~/.pi/agent/sub-meter/settings.json` (or the equivalent directory when `PI_CODING_AGENT_DIR` is set):

```json
{
  "display": "rotate",
  "rotateSeconds": 8,
  "refreshSeconds": 60,
  "warnAt": 75,
  "dangerAt": 90
}
```

Invalid values use the defaults. `refreshSeconds` cannot be lower than 30. Cached usage is stored separately in `~/.pi/agent/sub-meter/cache.json`; neither file contains credentials.

## How it works

- `session_start` loads settings and the active provider's cached usage, then refreshes stale data. `model_select` swaps providers and hides the widget when authentication or provider support is unavailable.
- `after_provider_response` reads Codex rate-limit headers immediately. `turn_end` refreshes stale usage when headers or cached data are not enough. Codex uses `ctx.modelRegistry.isUsingOAuth()`; OpenCode Go resolves its key with `getApiKeyForProvider("opencode-go")`.
- A periodic UI tick rotates windows, recomputes reset countdowns, and picks up newer cache writes from other pi sessions. Refreshes are deduplicated per provider, and failures retain the last snapshot with exponential backoff.
- `setWidget("sub-meter", …, { placement: "aboveEditor" })` installs the single-line component. Width-aware rendering drops decoration as space runs out.
- `session_shutdown` clears the timer, aborts pending requests, and removes the widget. Non-TUI modes do not create a timer, render a widget, or fetch usage.

Run the pure-logic tests with:

```sh
node --test "tunings/*/test/*.test.ts"
```
