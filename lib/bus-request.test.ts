/**
 * The handshake's three guarantees, apart from the three questions that use it: one
 * answer settles a request, a caller with no listener is told so instead of left
 * waiting, and a claim that never answers is bounded instead of hanging the call.
 *
 * Adoption is proved by each channel's own suite — `http/mount.test.ts`,
 * `plan/extension.test.ts`, and `session-bus/extension.test.ts` run the real callers
 * against this module, so a case here is about the rule they all lean on, not about
 * what any one of them asks.
 */

import { describe, expect, test } from "bun:test";
import { createFakePi } from "../test/helpers/fakes.ts";
import { ANSWER_BOUND_MS, requestOverBus } from "./bus-request.ts";

const CHANNEL = "my-pi-agent/test/request";

/** The payload one channel carries: what was asked, and the answer's one door. */
interface Question {
	asked: string;
	respond: (answer: string | Promise<string>) => void;
}

/** A request whose caller answers "nobody answered" when nothing claims it. */
function spec(asked = "anyone?") {
	return {
		channel: CHANNEL,
		payload: (respond: (answer: string | Promise<string>) => void): Question => ({ asked, respond }),
		unclaimed: () => "nobody answered",
	};
}

/**
 * The bound, captured rather than armed: no test line arms a real timer (`test/conventions.test.ts`),
 * and the case that matters is what happens *when it fires*, so the suite fires it itself.
 */
function clock() {
	const armed: Array<{ ms: number; fire: () => void }> = [];
	let cancelled = 0;
	return {
		seams: {
			timer: (ms: number, fire: () => void) => {
				armed.push({ ms, fire });
				return () => {
					cancelled += 1;
				};
			},
		},
		armed,
		cancelled: () => cancelled,
	};
}

/** A listener that claims the request and never answers it: the one failure mode with no end. */
function silentOwner(fake: ReturnType<typeof createFakePi>): void {
	fake.pi.events.on(CHANNEL, (data: unknown) => (data as Question).respond(new Promise<string>(() => undefined)));
}

describe("requestOverBus", () => {
	test("settles the one answer a listener gives, and ignores a second", async () => {
		const fake = createFakePi();
		fake.pi.events.on(CHANNEL, (data: unknown) => (data as Question).respond("first"));
		fake.pi.events.on(CHANNEL, (data: unknown) => (data as Question).respond("second"));

		expect(await requestOverBus(fake.pi, spec())).toBe("first");
	});

	test("carries the caller's own payload beside the answer", async () => {
		const fake = createFakePi();
		const asked: string[] = [];
		fake.pi.events.on(CHANNEL, (data: unknown) => {
			const question = data as Question;
			asked.push(question.asked);
			question.respond("ok");
		});

		expect(await requestOverBus(fake.pi, spec("who is there?"))).toBe("ok");
		expect(asked).toEqual(["who is there?"]);
	});

	test("tells a caller with no listener on the microtask, never synchronously", async () => {
		let quiet = true;
		const answer = requestOverBus(createFakePi().pi, spec()).then((value) => {
			quiet = false;
			return value;
		});

		// The emit answered nobody, so the fallback is a microtask away: a caller that
		// reads its own state in the same tick does not see a settled request.
		expect(quiet).toBe(true);
		expect(await answer).toBe("nobody answered");
	});

	test("waits for a claim that is still working rather than falling back", async () => {
		const fake = createFakePi();
		fake.pi.events.on(CHANNEL, (data: unknown) => {
			// An owner that binds a socket or starts a bus: claimed now, answered later.
			(data as Question).respond(new Promise<string>((resolve) => queueMicrotask(() => resolve("late"))));
		});

		expect(await requestOverBus(fake.pi, spec())).toBe("late");
	});

	test("reports a failed claim through failed, and through the fallback without one", async () => {
		const fake = createFakePi();
		fake.pi.events.on(CHANNEL, (data: unknown) => {
			(data as Question).respond(Promise.reject(new Error("the bus died")));
		});

		expect(await requestOverBus(fake.pi, { ...spec(), failed: (error) => `failed: ${(error as Error).message}` })).toBe(
			"failed: the bus died",
		);
		expect(await requestOverBus(fake.pi, spec())).toBe("nobody answered");
	});

	test("settles a claim that never answers on the bound, with the sentence it was given", async () => {
		const fake = createFakePi();
		silentOwner(fake);
		const timer = clock();
		const request = requestOverBus(
			fake.pi,
			{ ...spec(), timedOut: () => "the bus is on and did not answer" },
			timer.seams,
		);

		expect(timer.armed).toHaveLength(1);
		expect(timer.armed[0]?.ms).toBe(ANSWER_BOUND_MS);
		timer.armed[0]?.fire();
		// Firing again is the settled request's own no-op, not a second answer.
		timer.armed[0]?.fire();
		expect(await request).toBe("the bus is on and did not answer");
		expect(timer.cancelled()).toBe(1);
	});

	test("gives a caller with no timedOut its unclaimed sentence, so the default cannot rot", async () => {
		const fake = createFakePi();
		silentOwner(fake);
		const timer = clock();
		const request = requestOverBus(fake.pi, spec(), timer.seams);

		timer.armed[0]?.fire();
		expect(await request).toBe("nobody answered");
	});

	test("cancels the bound on all three endings", async () => {
		const answeredFake = createFakePi();
		answeredFake.pi.events.on(CHANNEL, (data: unknown) => (data as Question).respond("now"));
		const answered = clock();
		expect(await requestOverBus(answeredFake.pi, spec(), answered.seams)).toBe("now");
		expect(answered.cancelled()).toBe(1);

		const failedFake = createFakePi();
		failedFake.pi.events.on(CHANNEL, (data: unknown) =>
			(data as Question).respond(Promise.reject(new Error("too late"))),
		);
		const failed = clock();
		expect(await requestOverBus(failedFake.pi, spec(), failed.seams)).toBe("nobody answered");
		expect(failed.cancelled()).toBe(1);

		// Nobody claimed, so the microtask settles it: the bound was armed and must be dropped
		// with it, or every call to a session without the extension leaves a timer behind.
		const quiet = clock();
		expect(await requestOverBus(createFakePi().pi, spec(), quiet.seams)).toBe("nobody answered");
		expect(quiet.cancelled()).toBe(1);
	});
});
