import { describe, expect, test } from "bun:test";
import { MAX_COMMAND, MAX_LABEL, MAX_STDIN, normalizeCall } from "./schema.ts";
import { asAction } from "../../test/helpers/fixtures/job.ts";

describe("job schema", () => {
	test("rejects an unknown action", async () => {
		expect(() => normalizeCall({ action: "explode" })).toThrow("action must be one of");
		expect(() => normalizeCall({})).toThrow("action must be one of");
	});

	test("accepts each valid action", async () => {
		for (const action of ["list", "clear"] as const) {
			expect(normalizeCall({ action }).action).toBe(action);
		}
	});

	test("start requires a non-empty command and trims it", async () => {
		expect(() => normalizeCall({ action: "start" })).toThrow("requires a command");
		expect(() => normalizeCall({ action: "start", command: "   " })).toThrow("requires a command");
		expect(asAction(normalizeCall({ action: "start", command: "  bun test  " }), "start").command).toBe("bun test");
	});

	test("start rejects an over-long command", async () => {
		expect(() => normalizeCall({ action: "start", command: "x".repeat(MAX_COMMAND + 1) })).toThrow("longer than");
	});

	test("start rejects an over-long label but accepts a normal one", async () => {
		expect(() => normalizeCall({ action: "start", command: "x", label: "y".repeat(MAX_LABEL + 1) })).toThrow(
			"longer than",
		);
		expect(asAction(normalizeCall({ action: "start", command: "x", label: " build " }), "start").label).toBe("build");
	});

	test("start forwards wake, detached, and cwd", async () => {
		const call = asAction(
			normalizeCall({ action: "start", command: "x", wake: true, detached: true, cwd: " /repo " }),
			"start",
		);
		expect(call.wake).toBe(true);
		expect(call.detached).toBe(true);
		expect(call.cwd).toBe("/repo");
	});

	test("start validates and forwards the auto-kill timeout", async () => {
		expect(() => normalizeCall({ action: "start", command: "x", timeoutMs: 0 })).toThrow("timeoutMs must be between");
		expect(() => normalizeCall({ action: "start", command: "x", timeoutMs: -1 })).toThrow("timeoutMs must be between");
		expect(() => normalizeCall({ action: "start", command: "x", timeoutMs: 86_400_001 })).toThrow(
			"timeoutMs must be between",
		);
		expect(asAction(normalizeCall({ action: "start", command: "x", timeoutMs: 5000 }), "start").timeoutMs).toBe(5000);
	});

	test("start forwards the stdin opt-in", async () => {
		expect(asAction(normalizeCall({ action: "start", command: "x", stdin: true }), "start").stdin).toBe(true);
		expect(asAction(normalizeCall({ action: "start", command: "x" }), "start").stdin).toBeUndefined();
	});

	test("id-taking actions require an id", async () => {
		for (const action of ["status", "logs", "send", "kill", "wait"]) {
			expect(() => normalizeCall({ action })).toThrow("requires an id");
		}
		expect(asAction(normalizeCall({ action: "status", id: "j2" }), "status").id).toBe("j2");
	});

	test("logs validates line bounds", async () => {
		expect(() => normalizeCall({ action: "logs", id: "j1", lines: 0 })).toThrow("lines must be between");
		expect(() => normalizeCall({ action: "logs", id: "j1", lines: 99999 })).toThrow("lines must be between");
		expect(asAction(normalizeCall({ action: "logs", id: "j1", lines: 50 }), "logs").lines).toBe(50);
	});

	test("kill validates the signal", async () => {
		expect(() => normalizeCall({ action: "kill", id: "j1", signal: "SIGUSR1" })).toThrow("signal must be one of");
		expect(asAction(normalizeCall({ action: "kill", id: "j1", signal: "SIGKILL" }), "kill").signal).toBe("SIGKILL");
		expect(asAction(normalizeCall({ action: "kill", id: "j1" }), "kill").signal).toBeUndefined();
	});

	test("wait validates the timeout", async () => {
		expect(() => normalizeCall({ action: "wait", id: "j1", timeoutMs: -1 })).toThrow("timeoutMs must be between");
		expect(asAction(normalizeCall({ action: "wait", id: "j1", timeoutMs: 100 }), "wait").timeoutMs).toBe(100);
	});

	test("clear forwards all", async () => {
		expect(asAction(normalizeCall({ action: "clear", all: true }), "clear").all).toBe(true);
	});

	test("send requires input or eof", async () => {
		expect(() => normalizeCall({ action: "send", id: "j1" })).toThrow("requires `input` or `eof: true`");
		expect(() => normalizeCall({ action: "send", id: "j1", input: "" })).toThrow("requires `input` or `eof: true`");
		expect(asAction(normalizeCall({ action: "send", id: "j1", eof: true }), "send").eof).toBe(true);
		expect(asAction(normalizeCall({ action: "send", id: "j1", eof: true }), "send").input).toBeUndefined();
	});

	test("send caps the input length and rejects a non-string", async () => {
		expect(() => normalizeCall({ action: "send", id: "j1", input: "x".repeat(MAX_STDIN + 1) })).toThrow("longer than");
		expect(() => normalizeCall({ action: "send", id: "j1", input: 5 })).toThrow("must be a string");
		expect(asAction(normalizeCall({ action: "send", id: "j1", input: "hi" }), "send").input).toBe("hi");
	});

	test("send forwards newline and eof only when given", async () => {
		expect(asAction(normalizeCall({ action: "send", id: "j1", input: "y", newline: false }), "send").newline).toBe(
			false,
		);
		expect(asAction(normalizeCall({ action: "send", id: "j1", input: "y" }), "send").newline).toBeUndefined();
		expect(asAction(normalizeCall({ action: "send", id: "j1", input: "y", eof: true }), "send").eof).toBe(true);
	});
});
