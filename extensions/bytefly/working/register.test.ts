import { describe, expect, test } from "bun:test";
import { emit, makeFakePi } from "../../../test/helpers/fakes.ts";
import { WORKING_CONFIG } from "./config.ts";
import { registerWorkingTimer } from "./register.ts";

/** A context double that records the working message the timer drives. */
function fakeCtx(mode = "tui") {
	const messages: Array<string | undefined> = [];
	const ctx: any = {
		mode,
		ui: {
			setWorkingMessage: (message?: string) => messages.push(message),
		},
	};
	return { ctx, messages };
}

/** A clock and scheduler a test advances by hand. */
function fakeClock() {
	let time = 0;
	let tick: (() => void) | undefined;
	let scheduledMs: number | undefined;
	let cancelled = false;
	return {
		now: () => time,
		schedule: (fn: () => void, intervalMs: number) => {
			tick = fn;
			scheduledMs = intervalMs;
			return () => {
				cancelled = true;
			};
		},
		advance: (ms: number) => {
			time += ms;
			tick?.();
		},
		isCancelled: () => cancelled,
		scheduledMs: () => scheduledMs,
	};
}

describe("registerWorkingTimer", () => {
	test("counts elapsed seconds on the working row while it is up", async () => {
		const { pi } = makeFakePi();
		const clock = fakeClock();
		registerWorkingTimer(pi, clock);
		const { ctx, messages } = fakeCtx();

		await emit(pi, "turn_start", {}, ctx);
		expect(messages.at(-1)).toBe("Working… 0s");

		clock.advance(1000);
		expect(messages.at(-1)).toBe("Working… 1s");

		clock.advance(2000);
		expect(messages.at(-1)).toBe("Working… 3s");
	});

	test("does not restart on a later turn of the same run", async () => {
		const { pi } = makeFakePi();
		const clock = fakeClock();
		registerWorkingTimer(pi, clock);
		const { ctx, messages } = fakeCtx();

		await emit(pi, "turn_start", {}, ctx);
		clock.advance(5000);
		await emit(pi, "turn_start", {}, ctx);

		expect(messages.at(-1)).toBe("Working… 5s");
	});

	test("shows the first top-level tool and counts it", async () => {
		const { pi } = makeFakePi();
		registerWorkingTimer(pi, fakeClock());
		const { ctx, messages } = fakeCtx();

		await emit(pi, "turn_start", {}, ctx);
		await emit(pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, ctx);

		expect(messages.at(-1)).toBe("read · 1 tool · 0s");
	});

	test("counts top-level tools and names the latest", async () => {
		const { pi } = makeFakePi();
		const clock = fakeClock();
		registerWorkingTimer(pi, clock);
		const { ctx, messages } = fakeCtx();

		await emit(pi, "turn_start", {}, ctx);
		await emit(pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, ctx);
		await emit(pi, "tool_execution_start", { toolCallId: "2", toolName: "edit" }, ctx);
		await emit(pi, "tool_execution_start", { toolCallId: "3", toolName: "bash" }, ctx);
		expect(messages.at(-1)).toBe("bash · 3 tools · 0s");

		clock.advance(1000);
		expect(messages.at(-1)).toBe("bash · 3 tools · 1s");
	});

	test("ignores a nested tool", async () => {
		const { pi } = makeFakePi();
		registerWorkingTimer(pi, fakeClock());
		const { ctx, messages } = fakeCtx();

		await emit(pi, "turn_start", {}, ctx);
		await emit(pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, ctx);
		const before = messages.length;
		await emit(pi, "tool_execution_start", { toolCallId: "2", toolName: "inner", parentToolCallId: "1" }, ctx);

		expect(messages).toHaveLength(before);
		expect(messages.at(-1)).toBe("read · 1 tool · 0s");
	});

	test("keeps the run line across later turns of one run", async () => {
		const { pi } = makeFakePi();
		const clock = fakeClock();
		registerWorkingTimer(pi, clock);
		const { ctx, messages } = fakeCtx();

		await emit(pi, "turn_start", {}, ctx);
		await emit(pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, ctx);
		clock.advance(5000);
		await emit(pi, "turn_start", {}, ctx);

		expect(messages.at(-1)).toBe("read · 1 tool · 5s");
	});

	test("ignores a tool that starts outside a run", async () => {
		const { pi } = makeFakePi();
		registerWorkingTimer(pi, fakeClock());
		const { ctx, messages } = fakeCtx();

		await emit(pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, ctx);
		expect(messages).toHaveLength(0);

		await emit(pi, "turn_start", {}, ctx);
		expect(messages.at(-1)).toBe("Working… 0s");
	});

	test("resets the run line on a new run", async () => {
		const { pi } = makeFakePi();
		registerWorkingTimer(pi, fakeClock());
		const { ctx, messages } = fakeCtx();

		await emit(pi, "turn_start", {}, ctx);
		await emit(pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, ctx);
		await emit(pi, "agent_end", {}, ctx);
		await emit(pi, "turn_start", {}, ctx);

		expect(messages.at(-1)).toBe("Working… 0s");
	});

	test("cancels the tick and restores Pi's default when the run ends", async () => {
		const { pi } = makeFakePi();
		const clock = fakeClock();
		registerWorkingTimer(pi, clock);
		const { ctx, messages } = fakeCtx();

		await emit(pi, "turn_start", {}, ctx);
		await emit(pi, "agent_end", {}, ctx);

		expect(messages.at(-1)).toBeUndefined();
		expect(clock.isCancelled()).toBe(true);
	});

	test("does nothing outside interactive mode", async () => {
		const { pi } = makeFakePi();
		registerWorkingTimer(pi, fakeClock());
		const { ctx, messages } = fakeCtx("print");

		await emit(pi, "turn_start", {}, ctx);

		expect(messages).toHaveLength(0);
	});

	test("restores the message on shutdown", async () => {
		const { pi } = makeFakePi();
		const clock = fakeClock();
		registerWorkingTimer(pi, clock);
		const { ctx, messages } = fakeCtx();

		await emit(pi, "turn_start", {}, ctx);
		await emit(pi, "session_shutdown", {}, ctx);

		expect(messages.at(-1)).toBeUndefined();
		expect(clock.isCancelled()).toBe(true);
	});

	test("a new run after the previous one ends restarts the count", async () => {
		const { pi } = makeFakePi();
		const clock = fakeClock();
		registerWorkingTimer(pi, clock);
		const { ctx, messages } = fakeCtx();

		await emit(pi, "turn_start", {}, ctx);
		clock.advance(5000);
		await emit(pi, "agent_end", {}, ctx);
		await emit(pi, "turn_start", {}, ctx);

		expect(messages.at(-1)).toBe("Working… 0s");
	});

	test("schedules the tick at the configured interval", async () => {
		const { pi } = makeFakePi();
		const clock = fakeClock();
		registerWorkingTimer(pi, clock);
		const { ctx } = fakeCtx();

		await emit(pi, "turn_start", {}, ctx);

		expect(clock.scheduledMs()).toBe(WORKING_CONFIG.intervalMs);
	});
});
