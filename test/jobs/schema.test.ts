import { describe, expect, test } from "bun:test";
import { MAX_COMMAND, MAX_LABEL, normalizeCall } from "../../extensions/jobs/schema.ts";

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
		expect(normalizeCall({ action: "start", command: "  bun test  " }).command).toBe("bun test");
	});

	test("start rejects an over-long command", () => {
		expect(() => normalizeCall({ action: "start", command: "x".repeat(MAX_COMMAND + 1) })).toThrow("longer than");
	});

	test("start rejects an over-long label but accepts a normal one", () => {
		expect(() => normalizeCall({ action: "start", command: "x", label: "y".repeat(MAX_LABEL + 1) })).toThrow(
			"longer than",
		);
		expect(normalizeCall({ action: "start", command: "x", label: " build " }).label).toBe("build");
	});

	test("start forwards wake, detached, and cwd", () => {
		const call = normalizeCall({ action: "start", command: "x", wake: true, detached: true, cwd: " /repo " });
		expect(call.wake).toBe(true);
		expect(call.detached).toBe(true);
		expect(call.cwd).toBe("/repo");
	});

	test("id-taking actions require an id", () => {
		for (const action of ["status", "logs", "kill", "wait"]) {
			expect(() => normalizeCall({ action })).toThrow("requires an id");
		}
		expect(normalizeCall({ action: "status", id: "j2" }).id).toBe("j2");
	});

	test("logs validates line bounds", () => {
		expect(() => normalizeCall({ action: "logs", id: "j1", lines: 0 })).toThrow("lines must be between");
		expect(() => normalizeCall({ action: "logs", id: "j1", lines: 99999 })).toThrow("lines must be between");
		expect(normalizeCall({ action: "logs", id: "j1", lines: 50 }).lines).toBe(50);
	});

	test("kill validates the signal", () => {
		expect(() => normalizeCall({ action: "kill", id: "j1", signal: "SIGUSR1" })).toThrow("signal must be one of");
		expect(normalizeCall({ action: "kill", id: "j1", signal: "SIGKILL" }).signal).toBe("SIGKILL");
		expect(normalizeCall({ action: "kill", id: "j1" }).signal).toBeUndefined();
	});

	test("wait validates the timeout", () => {
		expect(() => normalizeCall({ action: "wait", id: "j1", timeoutMs: -1 })).toThrow("timeoutMs must be between");
		expect(normalizeCall({ action: "wait", id: "j1", timeoutMs: 100 }).timeoutMs).toBe(100);
	});

	test("clear forwards all", () => {
		expect(normalizeCall({ action: "clear", all: true }).all).toBe(true);
	});
});
