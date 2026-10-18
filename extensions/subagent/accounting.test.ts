import { describe, expect, test } from "bun:test";
import type { SingleResult } from "./types.ts";
import { emptyUsage } from "./stream.ts";
import { finishedEvent } from "./accounting.ts";

/** A finished run with the given usage. */
function result(over: Partial<SingleResult> = {}): SingleResult {
	return {
		agent: "explorer",
		task: "look",
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { ...emptyUsage(), input: 1000, output: 200, cacheRead: 50, cacheWrite: 10, cost: 0.02, turns: 1 },
		provider: "anthropic",
		model: "opus-4.5",
		finishedAt: 1_700_000_000_000,
		...over,
	};
}

describe("finishedEvent", () => {
	test("carries the child's pricing inputs and finish time", () => {
		expect(finishedEvent(result())).toEqual({
			agent: "explorer",
			provider: "anthropic",
			model: "opus-4.5",
			input: 1000,
			output: 200,
			cacheRead: 50,
			cacheWrite: 10,
			recordedCost: 0.02,
			at: 1_700_000_000_000,
			exitCode: 0,
		});
	});

	test("reports a run with no usage as nothing to account for", () => {
		expect(finishedEvent(result({ usage: emptyUsage() }))).toBeNull();
	});

	test("keeps an unknown provider or model null rather than guessing", () => {
		const event = finishedEvent(result({ provider: undefined, model: undefined, finishedAt: undefined }));
		expect(event).toMatchObject({ provider: null, model: null, at: null });
	});

	test("still reports a failed run that spent tokens", () => {
		const event = finishedEvent(result({ exitCode: 1, stopReason: "error" }));
		expect(event?.exitCode).toBe(1);
		expect(event?.input).toBe(1000);
	});
});
