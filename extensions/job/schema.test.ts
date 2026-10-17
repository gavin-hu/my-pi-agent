import { describe, expect, test } from "bun:test";
import { MAX_COMMAND, MAX_LABEL, MAX_STDIN, normalizeCall } from "./schema.ts";

/** Narrow a normalized call to the `start` branch (fails the test otherwise). */
function startCall(raw: unknown) {
	const call = normalizeCall(raw);
	if (call.action !== "start") throw new Error(`expected start, got ${call.action}`);
	return call;
}
function statusCall(raw: unknown) {
	const call = normalizeCall(raw);
	if (call.action !== "status") throw new Error(`expected status, got ${call.action}`);
	return call;
}
function logsCall(raw: unknown) {
	const call = normalizeCall(raw);
	if (call.action !== "logs") throw new Error(`expected logs, got ${call.action}`);
	return call;
}
function killCall(raw: unknown) {
	const call = normalizeCall(raw);
	if (call.action !== "kill") throw new Error(`expected kill, got ${call.action}`);
	return call;
}
function waitCall(raw: unknown) {
	const call = normalizeCall(raw);
	if (call.action !== "wait") throw new Error(`expected wait, got ${call.action}`);
	return call;
}
function clearCall(raw: unknown) {
	const call = normalizeCall(raw);
	if (call.action !== "clear") throw new Error(`expected clear, got ${call.action}`);
	return call;
}
function sendCall(raw: unknown) {
	const call = normalizeCall(raw);
	if (call.action !== "send") throw new Error(`expected send, got ${call.action}`);
	return call;
}

describe("normalizeCall", () => {
	test("rejects an unknown action", () => {
		expect(() => normalizeCall({ action: "explode" })).toThrow("action must be one of");
		expect(() => normalizeCall({})).toThrow("action must be one of");
	});

	test("accepts each valid action", () => {
		for (const action of ["list", "clear"] as const) {
			expect(normalizeCall({ action }).action).toBe(action);
		}
	});

	test("start requires a non-empty command and trims it", () => {
		expect(() => normalizeCall({ action: "start" })).toThrow("requires a command");
		expect(() => normalizeCall({ action: "start", command: "   " })).toThrow("requires a command");
		expect(startCall({ action: "start", command: "  bun test  " }).command).toBe("bun test");
	});

	test("start rejects an over-long command", () => {
		expect(() => normalizeCall({ action: "start", command: "x".repeat(MAX_COMMAND + 1) })).toThrow("longer than");
	});

	test("start rejects an over-long label but accepts a normal one", () => {
		expect(() => normalizeCall({ action: "start", command: "x", label: "y".repeat(MAX_LABEL + 1) })).toThrow(
			"longer than",
		);
		expect(startCall({ action: "start", command: "x", label: " build " }).label).toBe("build");
	});

	test("start forwards wake, detached, and cwd", () => {
		const call = startCall({ action: "start", command: "x", wake: true, detached: true, cwd: " /repo " });
		expect(call.wake).toBe(true);
		expect(call.detached).toBe(true);
		expect(call.cwd).toBe("/repo");
	});

	test("start validates and forwards the auto-kill timeout", () => {
		expect(() => normalizeCall({ action: "start", command: "x", timeoutMs: 0 })).toThrow("timeoutMs must be between");
		expect(() => normalizeCall({ action: "start", command: "x", timeoutMs: -1 })).toThrow("timeoutMs must be between");
		expect(() => normalizeCall({ action: "start", command: "x", timeoutMs: 86_400_001 })).toThrow(
			"timeoutMs must be between",
		);
		expect(startCall({ action: "start", command: "x", timeoutMs: 5000 }).timeoutMs).toBe(5000);
	});

	test("start forwards the stdin opt-in", () => {
		expect(startCall({ action: "start", command: "x", stdin: true }).stdin).toBe(true);
		expect(startCall({ action: "start", command: "x" }).stdin).toBeUndefined();
	});

	test("id-taking actions require an id", () => {
		for (const action of ["status", "logs", "send", "kill", "wait"]) {
			expect(() => normalizeCall({ action })).toThrow("requires an id");
		}
		expect(statusCall({ action: "status", id: "j2" }).id).toBe("j2");
	});

	test("logs validates line bounds", () => {
		expect(() => normalizeCall({ action: "logs", id: "j1", lines: 0 })).toThrow("lines must be between");
		expect(() => normalizeCall({ action: "logs", id: "j1", lines: 99999 })).toThrow("lines must be between");
		expect(logsCall({ action: "logs", id: "j1", lines: 50 }).lines).toBe(50);
	});

	test("kill validates the signal", () => {
		expect(() => normalizeCall({ action: "kill", id: "j1", signal: "SIGUSR1" })).toThrow("signal must be one of");
		expect(killCall({ action: "kill", id: "j1", signal: "SIGKILL" }).signal).toBe("SIGKILL");
		expect(killCall({ action: "kill", id: "j1" }).signal).toBeUndefined();
	});

	test("wait validates the timeout", () => {
		expect(() => normalizeCall({ action: "wait", id: "j1", timeoutMs: -1 })).toThrow("timeoutMs must be between");
		expect(waitCall({ action: "wait", id: "j1", timeoutMs: 100 }).timeoutMs).toBe(100);
	});

	test("clear forwards all", () => {
		expect(clearCall({ action: "clear", all: true }).all).toBe(true);
	});

	test("send requires input or eof", () => {
		expect(() => normalizeCall({ action: "send", id: "j1" })).toThrow("requires `input` or `eof: true`");
		expect(() => normalizeCall({ action: "send", id: "j1", input: "" })).toThrow("requires `input` or `eof: true`");
		expect(sendCall({ action: "send", id: "j1", eof: true }).eof).toBe(true);
		expect(sendCall({ action: "send", id: "j1", eof: true }).input).toBeUndefined();
	});

	test("send caps the input length and rejects a non-string", () => {
		expect(() => normalizeCall({ action: "send", id: "j1", input: "x".repeat(MAX_STDIN + 1) })).toThrow("longer than");
		expect(() => normalizeCall({ action: "send", id: "j1", input: 5 })).toThrow("must be a string");
		expect(sendCall({ action: "send", id: "j1", input: "hi" }).input).toBe("hi");
	});

	test("send forwards newline and eof only when given", () => {
		expect(sendCall({ action: "send", id: "j1", input: "y", newline: false }).newline).toBe(false);
		expect(sendCall({ action: "send", id: "j1", input: "y" }).newline).toBeUndefined();
		expect(sendCall({ action: "send", id: "j1", input: "y", eof: true }).eof).toBe(true);
	});
});
