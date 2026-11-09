# speed-meter

See how long your agent takes and how quickly the selected model generates, in pi's footer beside the built-in context information.

```text
0.4%/1.0M (auto)                          deepseek-v4.1-flash • high
task 18.4s ttft 420ms call 2.1s 47.3 tok/s p50
```

It is dim, lowercase, and space-separated like pi's own stats line, so it reads as part of the footer instead of a separate panel.

When the terminal is too narrow for the full line, only the essential user-facing measurements remain:

```text
task 18.4s 47.3 tok/s p50
```

`task` ticks while the agent is working and holds the last completed task's total time once it settles. Model metrics are rolling percentiles for the selected model, not aggregate server throughput.

Use `/speed-meter` for p95 values and sample counts. Use `/speed-meter reset` to clear the measurements.

## How it works

- `input` records when the user submitted work; `before_agent_start` establishes the task boundary.
- `before_provider_request` starts each model-call timer. The first streamed text, reasoning, or tool-call output observed through `message_update` records **TTFT**.
- `message_end` records a response's end-to-end latency and provider-reported output token count. Streaming deltas provide client-observed TTFT; no provider-specific APIs or network requests are needed.
- `agent_settled` records total task completion time, including model retries, tool execution, and follow-up model calls—not just the first response.
- `ctx.ui.setStatus("speed-meter", …)` adds a namespaced line to pi's standard footer without replacing the context-size footer or another extension's status. The text is styled with the footer's `dim` theme color.
- A terminal `resize` listener switches between full and compact layouts. The timer and listener exist only in TUI sessions and are released on shutdown.

Generation speed is steady decode speed, with initial waiting removed:

```text
(output tokens - 1) / (end-to-end latency - TTFT)
```

The footer shows the median (`p50`) of per-response speeds, so an unusually long response does not dominate the result. TTFT and model-call latency also use `p50`; `/speed-meter` adds `p95`.

Percentiles use the last **20 completed responses per selected model**. Failed and aborted responses are excluded. Responses with no measurable first output, no usable decode interval, or fewer than two reported output tokens still contribute call latency but do not create a speed sample. Unavailable measurements appear as `—` rather than estimates.

Measurements are in memory and reset on a new session or extension reload. Task time is the latest task, while model-call percentiles describe the recent response window.
