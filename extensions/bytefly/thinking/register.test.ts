import { describe, expect, test } from "bun:test";
import { emit, makeFakePi } from "../../../test/helpers/fakes.ts";
import { registerThinkingTimer } from "./register.ts";

/** A context double that records the label the counter drives. */
function fakeCtx(mode = "tui") {
	const labels: Array<string | undefined> = [];
	const ctx: any = {
		mode,
		ui: {
			setHiddenThinkingLabel: (label?: string) => labels.push(label),
		},
	};
	return { ctx, labels };
}

/** A clock and scheduler a test advances by hand. */
function fakeClock() {
	let time = 0;
	let tick: (() => void) | undefined;
	let cancelled = false;
	return {
		now: () => time,
		schedule: (fn: () => void) => {
			tick = fn;
			return () => {
				cancelled = true;
			};
		},
		advance: (ms: number) => {
			time += ms;
			tick?.();
		},
		isCancelled: () => cancelled,
	};
}

const assistant = { message: { role: "assistant" } };

describe("registerThinkingTimer", () => {
	test("counts elapsed seconds on the label while a message streams", async () => {
		const { pi } = makeFakePi();
		const clock = fakeClock();
		registerThinkingTimer(pi, clock);
		const { ctx, labels } = fakeCtx();

		await emit(pi, "message_start", assistant, ctx);
		expect(labels.at(-1)).toBe("Thinking… 0s");

		clock.advance(1000);
		expect(labels.at(-1)).toBe("Thinking… 1s");

		clock.advance(2000);
		expect(labels.at(-1)).toBe("Thinking… 3s");
	});

	test("cancels the tick and restores Pi's default when the message ends", async () => {
		const { pi } = makeFakePi();
		const clock = fakeClock();
		registerThinkingTimer(pi, clock);
		const { ctx, labels } = fakeCtx();

		await emit(pi, "message_start", assistant, ctx);
		await emit(pi, "message_end", assistant, ctx);

		expect(labels.at(-1)).toBeUndefined();
		expect(clock.isCancelled()).toBe(true);
	});

	test("ignores a message that is not from the assistant", async () => {
		const { pi } = makeFakePi();
		registerThinkingTimer(pi, fakeClock());
		const { ctx, labels } = fakeCtx();

		await emit(pi, "message_start", { message: { role: "user" } }, ctx);

		expect(labels).toHaveLength(0);
	});

	test("does nothing outside interactive mode", async () => {
		const { pi } = makeFakePi();
		registerThinkingTimer(pi, fakeClock());
		const { ctx, labels } = fakeCtx("print");

		await emit(pi, "message_start", assistant, ctx);

		expect(labels).toHaveLength(0);
	});

	test("restores the label on shutdown", async () => {
		const { pi } = makeFakePi();
		const clock = fakeClock();
		registerThinkingTimer(pi, clock);
		const { ctx, labels } = fakeCtx();

		await emit(pi, "message_start", assistant, ctx);
		await emit(pi, "session_shutdown", {}, ctx);

		expect(labels.at(-1)).toBeUndefined();
		expect(clock.isCancelled()).toBe(true);
	});

	test("a second message restarts the count cleanly", async () => {
		const { pi } = makeFakePi();
		const clock = fakeClock();
		registerThinkingTimer(pi, clock);
		const { ctx, labels } = fakeCtx();

		await emit(pi, "message_start", assistant, ctx);
		clock.advance(5000);
		await emit(pi, "message_end", assistant, ctx);
		await emit(pi, "message_start", assistant, ctx);

		expect(labels.at(-1)).toBe("Thinking… 0s");
	});
});
