import assert from "node:assert/strict";
import test from "node:test";
import { openCodeGoAdapter, parseOpenCodeGoUsage } from "../src/providers/opencode-go.ts";

const now = Date.UTC(2026, 0, 1);

function context(token = "secret-key") {
	return {
		model: { provider: "opencode-go" },
		modelRegistry: {
			isUsingOAuth: () => false,
			getApiKeyForProvider: async () => token,
		},
	};
}

test("OpenCode Go parser maps rolling, weekly, and monthly windows", () => {
	const snapshot = parseOpenCodeGoUsage({ usage: {
		rolling: { status: "ok", percent: 58, resetsAt: now + 60_000 },
		weekly: { status: "limited", percent: 101, resetsAt: "2026-01-08T00:00:00.000Z" },
		monthly: { percent: 20 },
	} }, now);
	assert.deepEqual(snapshot, {
		provider: "opencode-go",
		windows: [
			{ kind: "session", percentUsed: 58, resetsAt: now + 60_000 },
			{ kind: "week", percentUsed: 100, resetsAt: Date.UTC(2026, 0, 8) },
			{ kind: "month", percentUsed: 20 },
		],
		measuredAt: now,
		limited: true,
	});
});

test("OpenCode Go parser tolerates older fields and partial responses", () => {
	assert.deepEqual(parseOpenCodeGoUsage({ usage: { rolling: { usagePercent: 42, resetInSec: 90 } } }, now), {
		provider: "opencode-go",
		windows: [{ kind: "session", percentUsed: 42, resetsAt: now + 90_000 }],
		measuredAt: now,
	});
	assert.equal(parseOpenCodeGoUsage({ usage: {} }), undefined);
	assert.equal(parseOpenCodeGoUsage({ usage: { rolling: { percent: "42" } } }), undefined);
});

test("OpenCode Go adapter always uses the fixed origin", async (t) => {
	let requestedUrl: string | URL | Request | undefined;
	let redirect: RequestRedirect | undefined;
	let authorization: string | null = null;
	t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
		requestedUrl = url;
		redirect = init?.redirect;
		authorization = new Headers(init?.headers).get("authorization");
		return new Response(JSON.stringify({ usage: { rolling: { percent: 58 } } }), { status: 200 });
	});
	assert.equal(await openCodeGoAdapter.supports(context()), true);
	const snapshot = await openCodeGoAdapter.fetch(context(), new AbortController().signal);
	assert.equal(snapshot.windows[0].kind, "session");
	assert.equal(requestedUrl, "https://opencode.ai/zen/go/v1/usage");
	assert.equal(redirect, "error");
	assert.equal(authorization, "Bearer secret-key");
});

for (const [status, code, message] of [
	[401, "auth", "OpenCode Go rejected the API key; regenerate it and try again"],
	[403, "entitlement", "No active OpenCode Go subscription was found; regenerate the key if your subscription is active"],
] as const) {
	test(`OpenCode Go ${status} is a remembered auth/entitlement failure`, async (t) => {
		t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: status === 403 ? { type: "EntitlementError" } : undefined, secret: "secret-key" }), { status }));
		await assert.rejects(openCodeGoAdapter.fetch(context(), new AbortController().signal), (error: { code?: string; message: string }) => {
			assert.equal(error.code, code);
			assert.equal(error.message, message);
			assert.ok(!error.message.includes("secret-key"));
			return true;
		});
	});
}

test("OpenCode Go non-entitlement 403 remains retryable", async (t) => {
	t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: { type: "ForbiddenError" } }), { status: 403 }));
	await assert.rejects(openCodeGoAdapter.fetch(context(), new AbortController().signal), (error: { code?: string; status?: number }) => {
		assert.equal(error.code, "http");
		assert.equal(error.status, 403);
		return true;
	});
});

test("OpenCode Go malformed success response is an invalid response", async (t) => {
	t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 200 }));
	await assert.rejects(openCodeGoAdapter.fetch(context(), new AbortController().signal), /no valid windows/);
});
