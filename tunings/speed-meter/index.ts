import type { AssistantMessage, AssistantMessageEvent, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatDuration, formatRate, formatStatus } from "./src/format.ts";
import { appendSample, DEFAULT_HISTORY_SIZE, measureRequest, summarize, type RequestSample } from "./src/metrics.ts";

interface ActiveRequest {
	model: string;
	startedAt: number;
	ttftMs?: number;
}

function modelKey(model: Model<any> | undefined): string | undefined {
	return model ? `${model.provider}/${model.id}` : undefined;
}

function assistantModelKey(message: AssistantMessage): string {
	return `${message.provider}/${message.model}`;
}

function isFirstOutput(event: AssistantMessageEvent): boolean {
	switch (event.type) {
		case "text_delta":
		case "thinking_delta":
		case "toolcall_delta":
			return event.delta.length > 0;
		case "toolcall_start":
		case "toolcall_end":
			return true;
		case "text_end":
		case "thinking_end":
			return event.content.length > 0;
		default:
			return false;
	}
}

function isCompleted(message: AssistantMessage): boolean {
	return message.stopReason === "stop" || message.stopReason === "length" || message.stopReason === "toolUse";
}

export default function speedMeter(pi: ExtensionAPI) {
	const histories = new Map<string, RequestSample[]>();
	let currentContext: ExtensionContext | undefined;
	let activeRequest: ActiveRequest | undefined;
	let promptStartedAt: number | undefined;
	let taskStartedAt: number | undefined;
	let lastTaskMs: number | undefined;
	let taskModelCalls = 0;
	let lastSampleModel: string | undefined;
	let clock: ReturnType<typeof setInterval> | undefined;
	let resizeHandler: (() => void) | undefined;
	let tui = false;

	function samplesFor(ctx: ExtensionContext): RequestSample[] {
		const key = modelKey(ctx.model) ?? lastSampleModel;
		return key ? (histories.get(key) ?? []) : [];
	}

	function refreshStatus(ctx = currentContext): void {
		if (!tui || !ctx) return;
		const taskMs = taskStartedAt !== undefined ? Math.max(0, performance.now() - taskStartedAt) : lastTaskMs;
		const width = process.stdout.columns ?? 120;
		const status = formatStatus({ summary: summarize(samplesFor(ctx)), taskMs }, width);
		ctx.ui.setStatus("speed-meter", ctx.ui.theme.fg("dim", status));
	}

	function stopClock(): void {
		if (clock) clearInterval(clock);
		clock = undefined;
	}

	function startClock(): void {
		if (!tui || clock) return;
		clock = setInterval(() => refreshStatus(), 1000);
	}

	function releaseSessionResources(): void {
		stopClock();
		if (resizeHandler) process.stdout.off("resize", resizeHandler);
		resizeHandler = undefined;
	}

	function resetMeasurements(): void {
		histories.clear();
		activeRequest = undefined;
		promptStartedAt = undefined;
		taskStartedAt = undefined;
		lastTaskMs = undefined;
		taskModelCalls = 0;
		lastSampleModel = undefined;
	}

	pi.on("session_start", async (_event, ctx) => {
		releaseSessionResources();
		resetMeasurements();
		currentContext = ctx;
		tui = ctx.mode === "tui";
		if (tui) {
			resizeHandler = () => refreshStatus();
			process.stdout.on("resize", resizeHandler);
		}
		refreshStatus();
	});

	pi.on("session_shutdown", async () => {
		releaseSessionResources();
	});

	pi.on("input", async (_event, ctx) => {
		currentContext = ctx;
		promptStartedAt = performance.now();
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		currentContext = ctx;
		if (taskStartedAt === undefined) {
			taskStartedAt = promptStartedAt ?? performance.now();
			lastTaskMs = undefined;
			taskModelCalls = 0;
			startClock();
		}
		promptStartedAt = undefined;
		refreshStatus();
	});

	pi.on("before_provider_request", async (event, ctx) => {
		currentContext = ctx;
		activeRequest = {
			model: modelKey(ctx.model) ?? modelKey(event.model) ?? "unknown",
			startedAt: performance.now(),
		};
		taskModelCalls++;
	});

	pi.on("message_start", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		currentContext = ctx;
		if (!activeRequest) {
			activeRequest = {
				model: modelKey(ctx.model) ?? assistantModelKey(event.message),
				// The assistant timestamp is set when the provider stream is created.
				startedAt: performance.now() - Math.max(0, Date.now() - event.message.timestamp),
			};
		}
	});

	pi.on("message_update", async (event) => {
		if (!activeRequest || activeRequest.ttftMs !== undefined || event.message.role !== "assistant") return;
		if (isFirstOutput(event.assistantMessageEvent)) {
			activeRequest.ttftMs = Math.max(0, performance.now() - activeRequest.startedAt);
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		currentContext = ctx;
		const request = activeRequest;
		activeRequest = undefined;
		if (!isCompleted(event.message)) {
			refreshStatus();
			return;
		}
		const now = performance.now();
		const e2eMs =
			event.message.durationMs ??
			(request ? now - request.startedAt : Math.max(0, Date.now() - event.message.timestamp));
		const model = request?.model ?? modelKey(ctx.model) ?? assistantModelKey(event.message);
		const sample = measureRequest({
			model,
			e2eMs,
			ttftMs: request?.ttftMs,
			outputTokens: event.message.usage.output,
		});
		if (sample) {
			histories.set(model, appendSample(histories.get(model) ?? [], sample));
			lastSampleModel = model;
		}
		refreshStatus();
	});

	pi.on("model_select", async (_event, ctx) => {
		currentContext = ctx;
		refreshStatus();
	});

	pi.on("agent_settled", async (_event, ctx) => {
		currentContext = ctx;
		if (taskStartedAt !== undefined) {
			lastTaskMs = Math.max(0, performance.now() - taskStartedAt);
			taskStartedAt = undefined;
		}
		promptStartedAt = undefined;
		stopClock();
		refreshStatus();
	});

	pi.registerCommand("speed-meter", {
		description: "Show speed-meter latency details, or reset its rolling measurements",
		handler: async (args, ctx) => {
			currentContext = ctx;
			if (args.trim() === "reset") {
				histories.clear();
				lastTaskMs = undefined;
				lastSampleModel = undefined;
				taskModelCalls = 0;
				refreshStatus();
				ctx.ui.notify("speed-meter measurements reset", "info");
				return;
			}
			if (args.trim() !== "") {
				ctx.ui.notify("Usage: /speed-meter [reset]", "warning");
				return;
			}
			const summary = summarize(samplesFor(ctx));
			const taskMs = taskStartedAt !== undefined ? performance.now() - taskStartedAt : lastTaskMs;
			const taskLabel = taskStartedAt !== undefined ? "current task" : "last completed task";
			ctx.ui.notify(
				[
					`speed-meter · ${modelKey(ctx.model) ?? "unknown model"}`,
					`${taskLabel}: ${formatDuration(taskMs)} · ${taskModelCalls} model request${taskModelCalls === 1 ? "" : "s"}`,
					`TTFT: p50 ${formatDuration(summary.ttftP50Ms)} · p95 ${formatDuration(summary.ttftP95Ms)}`,
					`Model call E2E: p50 ${formatDuration(summary.e2eP50Ms)} · p95 ${formatDuration(summary.e2eP95Ms)}`,
					`Generation: p50 ${formatRate(summary.tokensPerSecondP50)} tok/s · p95 ${formatRate(summary.tokensPerSecondP95)} tok/s`,
					`${summary.speedSampleCount} speed samples from ${summary.requestCount} completed responses (last ${DEFAULT_HISTORY_SIZE})`,
				].join("\n"),
				"info",
			);
		},
	});
}
