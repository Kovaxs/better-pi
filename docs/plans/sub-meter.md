# Plan: `sub-meter` tuning (usage windows only)

Port of [better-claude `sub-meter`](https://github.com/midudev/better-claude/tree/main/plugins/sub-meter) to pi.

## Scope

In scope: subscription **usage windows** (percent used + reset time) for the active model's provider.

| pi provider | Auth | Shown | Source |
|---|---|---|---|
| `openai-codex` | ChatGPT OAuth | `5h` + `week` | `x-codex-*` response headers, then `GET https://chatgpt.com/backend-api/wham/usage` |
| `opencode-go` | Go API key | `5h` (rolling) + `week` | `GET https://opencode.ai/zen/go/v1/usage` |
| `opencode` (Zen) | API key | nothing | pay-as-you-go, no windows |
| `anthropic` | API key | nothing | API billing, no windows |
| anything else | — | nothing | — |

Out of scope: credit balance, budgets, cost meters, Admin APIs, Claude Pro/Max OAuth, and the upstream Claude Code hint-hiding options (`hideCycleHint`, `hideInterruptHint`).

Hard rules:
- Never send a model request just to read usage.
- Never write credentials to disk or into errors/logs.
- Unsupported provider or auth → the widget is cleared, never a fake `0%`.

## UI

Right-aligned widget above the editor (`ctx.ui.setWidget("sub-meter", factory, { placement: "aboveEditor" })`):

```text
                              5h ━━━━━━──── 58% ↻ 2h 10m
```

`both` mode:

```text
        5h ━━━━━━──── 58% ↻ 2h 10m  |  week ━━━─────── 31% ↻ 4d 3h
```

Matches upstream:
- 10 cells, filled with `Math.round(clamp(pct) / 10)`; percent text rounded.
- Normal < `warnAt` (75), `warning` color ≥ 75, `error` color ≥ `dangerAt` (90). Theme colors, not hard-coded ANSI.
- Reset format `42m`, `3h 5m`, `2d 4h`; no reset shown when unknown.
- A window whose reset has passed shows `0%`, empty bar, no countdown until the next reading.
- If the selected window is missing, show whichever window exists.
- Narrow terminal: full → no bars → no reset → hidden. Uses `visibleWidth` / `truncateToWidth` from `@earendil-works/pi-tui`.

Why a widget and not the footer: `setStatus()` text is joined left in a shared line, so we can't right-align or degrade by width; `setFooter()` replaces the whole footer and breaks coexistence with other tunings.

## Layout

```text
tunings/sub-meter/
├── README.md
├── index.ts                 # pi glue only
├── src/
│   ├── types.ts             # UsageWindow, UsageSnapshot, Settings
│   ├── format.ts            # bar, percent, color level, reset text, width fitting
│   ├── select.ts            # display mode → windows to render, rotation, expiry
│   ├── settings.ts          # defaults + validation + load/save
│   ├── cache.ts             # per-provider snapshot cache (atomic write)
│   └── providers/
│       ├── index.ts         # provider id → adapter | undefined
│       ├── codex.ts         # header parser + /wham/usage parser + fetch
│       └── opencode-go.ts   # /zen/go/v1/usage parser + fetch
└── test/
    ├── format.test.ts
    ├── select.test.ts
    ├── settings.test.ts
    ├── cache.test.ts
    ├── codex.test.ts
    └── opencode-go.test.ts
```

Root changes: add `package.json` (pi package, `keywords: ["pi-package"]`, `pi.extensions: ["tunings/sub-meter/index.ts"]`, host packages as `peerDependencies: "*"`), and `README.md` with the tunings table + install instructions.

## Data model

```ts
type WindowKind = "session" | "week" | "month";

interface UsageWindow {
  kind: WindowKind;
  percentUsed: number;      // 0–100, clamped
  resetsAt?: number;        // epoch ms
}

interface UsageSnapshot {
  provider: "openai-codex" | "opencode-go";
  windows: UsageWindow[];
  measuredAt: number;       // epoch ms
  limited?: boolean;        // provider says limit reached
}

interface UsageAdapter {
  provider: UsageSnapshot["provider"];
  supports(ctx): Promise<boolean>;                 // auth-type check
  fromHeaders?(headers: Record<string, string>, status: number): UsageWindow[] | undefined;
  fetch(ctx, signal: AbortSignal): Promise<UsageSnapshot>;
}
```

Parsers are pure functions taking `unknown` JSON / header records, so they're unit-tested with fixtures.

## Providers

### Codex (`openai-codex`)

- `supports`: `ctx.model.provider === "openai-codex"` and `ctx.modelRegistry.isUsingOAuth(ctx.model)`.
- Token: `ctx.modelRegistry.getApiKeyForProvider("openai-codex")` (pi refreshes OAuth for us). Account id: JWT claim `["https://api.openai.com/auth"].chatgpt_account_id`; skip if absent.
- Passive: `after_provider_response` → parse `x-codex-primary-used-percent`, `x-codex-secondary-used-percent`, `*-window-minutes`, `*-reset-after-seconds`, `*-reset-at`. Only applied while the active model is Codex (the event has no provider field).
- Active: `GET https://chatgpt.com/backend-api/wham/usage` with `Authorization: Bearer`, `ChatGPT-Account-Id`, `redirect: "error"`, 10 s timeout.
- Map `rate_limit.primary_window` / `secondary_window` by `limit_window_seconds` (≤ 1 day → `session`, ≤ 8 days → `week`), not by position — some plans put the weekly window in `primary`. Missing `secondary` stays missing, never `0%`.
- `rate_limit.limit_reached === true` → `limited`.
- Endpoint is undocumented: validate every field, keep last good snapshot on failure.

### OpenCode Go (`opencode-go`)

- `supports`: `ctx.model.provider === "opencode-go"` and a key resolves.
- Key: `ctx.modelRegistry.getApiKeyForProvider("opencode-go")` (covers `OPENCODE_API_KEY` and `auth.json`).
- `GET https://opencode.ai/zen/go/v1/usage`, `Authorization: Bearer`, `Accept: application/json`, `redirect: "error"`, 10 s timeout. Always this fixed origin, never the model's `baseUrl`.
- Response: `{ usage: { rolling|weekly|monthly: { status, percent, resetsAt } } }` → `session` / `week` / `month`.
- `403 EntitlementError` → treat as "no Go subscription": clear widget, remember for this session, explain in `/sub-meter status`.
- `401` → auth problem, same handling.
- Parser also tolerates `usagePercent` / `resetInSec` field names seen in older responses.

## Refresh model

| Trigger | Action |
|---|---|
| `session_start` | load settings, load cached snapshot for active provider, render, then refresh if older than `refreshSeconds` |
| `model_select` | swap to new provider's cache, render, refresh if stale; clear widget if unsupported |
| `after_provider_response` | Codex headers → update immediately (free) |
| `turn_end` | refresh if older than `refreshSeconds` |
| `/sub-meter refresh` | refresh now, ignoring throttle |
| UI tick (every `rotateSeconds`) | rotate window, recompute countdown/expiry, pick up newer cache written by another pi session |

- One in-flight request per provider; later triggers join it.
- Failure: keep last snapshot, back off (60 s → 5 min max), don't notify on every failure.
- Cache: `join(getAgentDir(), "sub-meter", "cache.json")`, keyed by provider, `{ windows, measuredAt, limited }` only. Write via temp file + rename. Newer `measuredAt` wins, which keeps concurrent sessions in sync like upstream's shared store.

## Lifecycle and modes

- Factory only registers handlers and the command. No timers, fetches, or file reads there.
- Timer + widget only when `ctx.mode === "tui"`. In `print` / `json` / `rpc` nothing renders and nothing is fetched (no point paying for a request nobody sees). `/sub-meter status` still works in RPC via `ctx.ui.notify` when `ctx.hasUI`.
- `session_shutdown` (idempotent): clear interval, abort controller, `setWidget("sub-meter", undefined)`.
- Never returns anything from `turn_end`, so no continuation loops.

## Settings and command

File: `join(getAgentDir(), "sub-meter", "settings.json")` (pi has no extension-settings API). Defaults:

```json
{
  "display": "rotate",
  "rotateSeconds": 8,
  "refreshSeconds": 60,
  "warnAt": 75,
  "dangerAt": 90
}
```

Invalid values fall back to defaults (upstream behavior: unknown `display` → `rotate`, `rotateSeconds <= 0` → 8). Clamp `refreshSeconds` to ≥ 30.

Command `/sub-meter` with argument completions:

| Command | Effect |
|---|---|
| `/sub-meter` or `status` | provider, auth type, windows, last update, last error (no secrets) |
| `/sub-meter rotate\|both\|session\|week` | set display mode, persist, re-render |
| `/sub-meter refresh` | force refresh |

## Steps

1. **Scaffold** root `package.json`, root `README.md`, `tunings/sub-meter/` skeleton. Commit `chore: scaffold betterpi package`.
2. **Pure formatting** — `format.ts`, `select.ts` + tests (bar cells, rounding, colors, reset text, expiry, fallback window, rotation, width degradation).
3. **Settings + cache** — validation, defaults, atomic write, newest-wins merge + tests.
4. **OpenCode Go adapter** — parser + fetch + tests with fixtures (ok, partial, 401, 403, malformed).
5. **Codex adapter** — header parser, `/wham/usage` parser, window classification, JWT account id + tests (fixtures incl. weekly-only primary, limit reached, malformed).
6. **Glue** — `index.ts`: events, widget component, timer, command, shutdown.
7. **README** for the tuning: one-line pitch, text mock, provider table, settings defaults, **How it works** naming `session_start`, `model_select`, `after_provider_response`, `turn_end`, `session_shutdown`, `setWidget`, `getApiKeyForProvider`.
8. **Verify** (below), then `jj commit -m "feat(sub-meter): show subscription usage windows above the prompt"`.

## Verification

Automated:

```bash
node --test "tunings/*/test/*.test.ts"
```

Manual:

```bash
pi -e ./tunings/sub-meter/index.ts            # interactive
pi -p "hi" -e ./tunings/sub-meter/index.ts    # print mode: no UI, no errors
pi -e .                                        # whole package
```

Checklist:
- [ ] Codex OAuth: both windows appear, values match ChatGPT usage page, countdown ticks.
- [ ] OpenCode Go: rolling/weekly appear, values match the console.
- [ ] Switch to `anthropic` (API key) or `opencode` (Zen): widget disappears; switch back: cached value reappears instantly.
- [ ] All four display modes; rotation every 8 s; single-window fallback.
- [ ] Resize narrow → bars drop, then reset, then hidden.
- [ ] Network offline: last value stays, no notification spam.
- [ ] Two pi sessions: a refresh in one shows up in the other within one tick.
- [ ] `/reload` and quit leave no timers running (no duplicate rotation after reload).
- [ ] Cache and status output contain no tokens.

## Risks

- `/wham/usage` is an internal ChatGPT endpoint and can change → strict parsing, graceful hide, headers as primary source when present.
- OpenCode Go has returned spurious `403` for active subscriptions in the past (anomalyco/opencode#49020, maintainer says likely fixed) → status command tells the user to regenerate the key.
- `after_provider_response` carries no provider id → only trust headers while the active model is Codex.
