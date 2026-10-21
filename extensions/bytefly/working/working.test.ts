import { describe, expect, test } from "bun:test";
import { makeClock } from "../../../test/helpers/clock.ts";
import { emit, makeFakePi } from "../../../test/helpers/fakes.ts";
import { WORKING_CONFIG } from "./config.ts";
import { formatElapsed, workingCounter } from "./format.ts";
import { registerWorkingTimer } from "./register.ts";

/**
 * The working row's message recorder plus a scheduler a test advances by hand.
 * The real timer is the one seam the suite never uses.
 */
function workingHarness(clock = makeClock()) {
	const messages: Array<string | undefined> = [];
	const ctx = {
		mode: "tui",
		ui: { setWorkingMessage: (message?: string) => messages.push(message) },
	};
	let tick: (() => void) | undefined;
	let intervalMs: number | undefined;
	let cancelled = false;
	const deps = {
		now: () => clock.now(),
		schedule: (fn: () => void, ms: number) => {
			tick = fn;
			intervalMs = ms;
			return () => {
				cancelled = true;
			};
		},
	};
	const { pi } = makeFakePi();
	registerWorkingTimer(pi, deps);
	return {
		pi,
		ctx,
		messages,
		clock,
		advance(ms: number) {
			clock.advance(ms);
			tick?.();
		},
		cancelled: () => cancelled,
		intervalMs: () => intervalMs,
	};
}

describe("formatElapsed", () => {
	test("reads sub-second and invalid input as 0s", () => {
		for (const value of [0, 999, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(formatElapsed(value), String(value)).toBe("0s");
		}
	});

	test("counts whole seconds under a minute", () => {
		expect(formatElapsed(1000)).toBe("1s");
		expect(formatElapsed(42_400)).toBe("42s");
		expect(formatElapsed(59_900)).toBe("59s");
	});

	test("pads seconds and minutes past their first unit", () => {
		expect(formatElapsed(60_000)).toBe("1m00s");
		expect(formatElapsed(65_000)).toBe("1m05s");
		expect(formatElapsed(3_600_000)).toBe("1h00m");
		expect(formatElapsed(3_930_000)).toBe("1h05m");
	});
});

describe("workingCounter", () => {
	test("keeps the plain count before the first tool starts", () => {
		expect(workingCounter(4000)).toBe("Working… 4s");
		expect(workingCounter(4000, { tool: null, tools: 0 })).toBe("Working… 4s");
	});

	test("names the latest tool and counts the run's top-level calls", () => {
		expect(workingCounter(4000, { tool: "edit", tools: 1 })).toBe("edit · 1 tool · 4s");
		expect(workingCounter(4000, { tool: "edit", tools: 3 })).toBe("edit · 3 tools · 4s");
	});

	test("omits an empty tool name but keeps the count", () => {
		expect(workingCounter(4000, { tool: "", tools: 2 })).toBe("2 tools · 4s");
	});

	test("sanitizes a tool name to one line", () => {
		expect(workingCounter(4000, { tool: "a\nb", tools: 1 })).toBe("a b · 1 tool · 4s");
	});
});

describe("registerWorkingTimer", () => {
	test("counts elapsed seconds while the working row is up", async () => {
		const h = workingHarness();
		await emit(h.pi, "turn_start", {}, h.ctx);
		expect(h.messages.at(-1)).toBe("Working… 0s");

		h.advance(1000);
		expect(h.messages.at(-1)).toBe("Working… 1s");
		h.advance(2000);
		expect(h.messages.at(-1)).toBe("Working… 3s");
	});

	test("keeps one count across later turns of the same run", async () => {
		const h = workingHarness();
		await emit(h.pi, "turn_start", {}, h.ctx);
		h.advance(5000);
		await emit(h.pi, "turn_start", {}, h.ctx);

		expect(h.messages.at(-1)).toBe("Working… 5s");
	});

	test("names and counts the latest top-level tool immediately", async () => {
		const h = workingHarness();
		await emit(h.pi, "turn_start", {}, h.ctx);
		await emit(h.pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, h.ctx);
		expect(h.messages.at(-1)).toBe("read · 1 tool · 0s");

		await emit(h.pi, "tool_execution_start", { toolCallId: "2", toolName: "edit" }, h.ctx);
		await emit(h.pi, "tool_execution_start", { toolCallId: "3", toolName: "bash" }, h.ctx);
		expect(h.messages.at(-1)).toBe("bash · 3 tools · 0s");

		h.advance(1000);
		expect(h.messages.at(-1)).toBe("bash · 3 tools · 1s");
	});

	test("ignores a nested tool, which is its parent's implementation detail", async () => {
		const h = workingHarness();
		await emit(h.pi, "turn_start", {}, h.ctx);
		await emit(h.pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, h.ctx);
		const before = h.messages.length;
		await emit(h.pi, "tool_execution_start", { toolCallId: "2", toolName: "inner", parentToolCallId: "1" }, h.ctx);

		expect(h.messages).toHaveLength(before);
		expect(h.messages.at(-1)).toBe("read · 1 tool · 0s");
	});

	test("ignores a tool that starts outside a run", async () => {
		const h = workingHarness();
		await emit(h.pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, h.ctx);
		expect(h.messages).toHaveLength(0);

		await emit(h.pi, "turn_start", {}, h.ctx);
		expect(h.messages.at(-1)).toBe("Working… 0s");
	});

	test("starts a new run from zero after the previous one ends", async () => {
		const h = workingHarness();
		await emit(h.pi, "turn_start", {}, h.ctx);
		await emit(h.pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, h.ctx);
		h.advance(5000);
		await emit(h.pi, "agent_end", {}, h.ctx);
		await emit(h.pi, "turn_start", {}, h.ctx);

		expect(h.messages.at(-1)).toBe("Working… 0s");
	});

	test("cancels the tick and gives the working message back when the run ends", async () => {
		const h = workingHarness();
		await emit(h.pi, "turn_start", {}, h.ctx);
		await emit(h.pi, "agent_end", {}, h.ctx);

		expect(h.messages.at(-1)).toBeUndefined();
		expect(h.cancelled()).toBe(true);
	});

	test("does the same on shutdown", async () => {
		const h = workingHarness();
		await emit(h.pi, "turn_start", {}, h.ctx);
		await emit(h.pi, "session_shutdown", {}, h.ctx);

		expect(h.messages.at(-1)).toBeUndefined();
		expect(h.cancelled()).toBe(true);
	});

	test("does nothing outside interactive mode", async () => {
		const h = workingHarness();
		await emit(h.pi, "turn_start", {}, { ...h.ctx, mode: "print" });

		expect(h.messages).toHaveLength(0);
	});

	test("schedules the tick at the configured interval", async () => {
		const h = workingHarness();
		await emit(h.pi, "turn_start", {}, h.ctx);

		expect(h.intervalMs()).toBe(WORKING_CONFIG.intervalMs);
	});
});
