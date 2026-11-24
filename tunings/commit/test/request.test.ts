import assert from "node:assert/strict";
import test from "node:test";
import { parseRequest, validBranchName } from "../src/request.ts";

test("bare input asks, explicit modes skip the menu, help does not commit", () => {
	assert.equal(parseRequest("  "), "ask");
	assert.equal(parseRequest("--help"), "help");
	assert.equal(parseRequest("help"), "help");
	assert.deepEqual(parseRequest("only"), { action: "only" });
	assert.deepEqual(parseRequest("  push  "), { action: "push" });
	assert.deepEqual(parseRequest("branch"), { action: "branch" });
	assert.deepEqual(parseRequest("branch feat/side-panel"), { action: "branch", branch: "feat/side-panel" });
});

test("rejects unknown modes, extra arguments, and unsafe branch names", () => {
	for (const args of ["--push", "only more", "push origin", "branch a b", "branch -bad", "branch a;echo", "branch a\nb"]) {
		assert.throws(() => parseRequest(args), undefined, args);
	}
});

test("conservative branch validation covers Git ref restrictions and shell metacharacters", () => {
	for (const name of ["feat/commit", "fix/a_b-2.3", "v1", "team/feat/sidebar"]) assert.equal(validBranchName(name), true, name);
	for (const name of ["", "HEAD", "-x", "/x", "x/", "a//b", "a..b", "a.lock", "x/a.lock", ".x", "a.", "a@{b}", "a b", "a~b", "a:b", "a?b", "a*b", "a[b", "a\\b", 'a"b', "a'b", "a`b", "a$b", "a;b"]) {
		assert.equal(validBranchName(name), false, name);
	}
});
