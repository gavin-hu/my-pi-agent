/**
 * The handshake's two guarantees, apart from the three questions that use it: one
 * answer settles a request, and a caller with no listener is told so instead of left
 * waiting.
 *
 * Adoption is proved by each channel's own suite — `http/mount.test.ts`,
 * `plan/extension.test.ts`, and `session-bus/extension.test.ts` run the real callers
 * against this module, so a case here is about the rule they all lean on, not about
 * what any one of them asks.
 */

import { describe, expect, test } from "bun:test";
import { createFakePi } from "../test/helpers/fakes.ts";
import { requestOverBus } from "./bus-request.ts";

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
});
