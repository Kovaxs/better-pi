import assert from "node:assert/strict";
import test from "node:test";
import { codexAccountId, codexAdapter, codexWindowKind, parseCodexHeaders, parseCodexUsage } from "../src/providers/codex.ts";

const now = Date.UTC(2026, 0, 1);

function tokenWithAccount(accountId: string): string {
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none" })}.${encode({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })}.signature`;
}

test("Codex headers parse case-insensitively and classify by duration", () => {
	const windows = parseCodexHeaders({
		"X-Codex-Primary-Used-Percent": "58",
		"x-codex-primary-window-minutes": "300",
		"x-codex-primary-reset-after-seconds": "7800",
		"x-codex-secondary-used-percent": "31.2",
		"x-codex-secondary-window-minutes": "10080",
		"x-codex-secondary-reset-at": "1800000000",
	}, now);
	assert.deepEqual(windows, [
		{ kind: "session", percentUsed: 58, resetsAt: now + 7_800_000 },
		{ kind: "week", percentUsed: 31.2, resetsAt: 1_800_000_000_000 },
	]);
	assert.deepEqual(parseCodexHeaders({ "x-codex-primary-used-percent": "58" }), undefined);
	assert.equal(codexWindowKind(86_400), "session");
	assert.equal(codexWindowKind(604_800), "week");
	assert.equal(codexWindowKind(2_592_000), "month");
});

test("wham usage supports a weekly primary and preserves a missing secondary", () => {
	const snapshot = parseCodexUsage({
		rate_limit: {
			primary_window: { used_percent: 72, limit_window_seconds: 604_800, reset_after_seconds: 3600 },
			limit_reached: true,
		},
	}, now);
	assert.deepEqual(snapshot, {
		provider: "openai-codex",
		windows: [{ kind: "week", percentUsed: 72, resetsAt: now + 3_600_000 }],
		measuredAt: now,
		limited: true,
	});
});

test("wham parser rejects malformed responses and clamps values", () => {
	assert.equal(parseCodexUsage({}), undefined);
	assert.equal(parseCodexUsage({ rate_limit: { primary_window: { used_percent: "50" } } }), undefined);
	assert.equal(parseCodexUsage({ rate_limit: { primary_window: { used_percent: 120, limit_window_seconds: 300 } } }, now)?.windows[0].percentUsed, 100);
});

test("Codex JWT account id extraction never throws", () => {
	assert.equal(codexAccountId(tokenWithAccount("account-123")), "account-123");
	assert.equal(codexAccountId("not a jwt"), undefined);
	assert.equal(codexAccountId("x.e30.signature"), undefined);
});

test("Codex adapter uses OAuth and fixed usage endpoint without leaking the token", async (t) => {
	const token = tokenWithAccount("account-123");
	let requestedUrl: string | URL | Request | undefined;
	let headers: Headers | undefined;
	t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
		requestedUrl = url;
		headers = new Headers(init?.headers);
		return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 58, limit_window_seconds: 18_000 } } }), { status: 200 });
	});
	const ctx = {
		model: { provider: "openai-codex" },
		modelRegistry: {
			isUsingOAuth: () => true,
			getApiKeyForProvider: async () => token,
		},
	};
	assert.equal(await codexAdapter.supports(ctx), true);
	const snapshot = await codexAdapter.fetch(ctx, new AbortController().signal);
	assert.equal(snapshot.windows[0].kind, "session");
	assert.equal(requestedUrl, "https://chatgpt.com/backend-api/wham/usage");
	assert.equal(headers?.get("chatgpt-account-id"), "account-123");
	assert.equal(headers?.get("authorization"), `Bearer ${token}`);
});

test("Codex adapter reports HTTP failures without response bodies or credentials", async (t) => {
	const token = tokenWithAccount("account-123");
	t.mock.method(globalThis, "fetch", async () => new Response(token, { status: 401 }));
	await assert.rejects(
		codexAdapter.fetch({
			model: { provider: "openai-codex" },
			modelRegistry: { isUsingOAuth: () => true, getApiKeyForProvider: async () => token },
		}, new AbortController().signal),
		(error: Error) => {
			assert.equal(error.message, "ChatGPT usage returned HTTP 401");
			assert.ok(!error.message.includes(token));
			return true;
		},
	);
});
