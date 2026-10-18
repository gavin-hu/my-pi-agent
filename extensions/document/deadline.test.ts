import { describe, expect, test } from "bun:test";
import { settle } from "../../test/helpers/process.ts";
import { withDeadline } from "./deadline.ts";

const TIMEOUT = "Extraction did not finish within 20 ms (document.extractTimeoutMs).";

describe("withDeadline", () => {
	test("returns work that finishes first", async () => {
		const value = await withDeadline(async () => "text", { timeoutMs: 1_000, timeoutMessage: TIMEOUT });
		expect(value).toBe("text");
	});

	test("rethrows the work's own error unchanged", async () => {
		const failure = new Error("the parser gave up");
		const run = withDeadline(async () => Promise.reject(failure), { timeoutMs: 1_000, timeoutMessage: TIMEOUT });
		await expect(run).rejects.toBe(failure);
	});

	test("rejects with the caller's message once the deadline passes", async () => {
		const run = withDeadline(() => new Promise<string>(() => {}), { timeoutMs: 20, timeoutMessage: TIMEOUT });
		await expect(run).rejects.toThrow(TIMEOUT);
	});

	test("prefers the turn's abort reason over the deadline", async () => {
		const controller = new AbortController();
		const run = withDeadline(
			() =>
				new Promise<string>((_resolve, reject) => {
					controller.signal.addEventListener("abort", () => reject(controller.signal.reason));
				}),
			{ timeoutMs: 10_000, timeoutMessage: TIMEOUT, signal: controller.signal },
		);
		controller.abort(new Error("the user cancelled"));
		await expect(run).rejects.toThrow("the user cancelled");
	});

	test("rejects immediately for an already-aborted turn", async () => {
		const controller = new AbortController();
		controller.abort(new Error("gone"));
		const run = withDeadline(() => new Promise<string>(() => {}), {
			timeoutMs: 10_000,
			timeoutMessage: TIMEOUT,
			signal: controller.signal,
		});
		await expect(run).rejects.toThrow("gone");
	});

	test("swallows a result that arrives after the deadline", async () => {
		let finish: ((value: string) => void) | undefined;
		const run = withDeadline(
			() =>
				new Promise<string>((resolve) => {
					finish = resolve;
				}),
			{ timeoutMs: 20, timeoutMessage: TIMEOUT },
		);
		await expect(run).rejects.toThrow(TIMEOUT);
		finish?.("too late");
		// Let the abandoned promise settle; an unhandled rejection would fail the run.
		await settle();
	});

	test("swallows a rejection that arrives after the deadline", async () => {
		let fail: ((error: Error) => void) | undefined;
		const run = withDeadline(
			() =>
				new Promise<string>((_resolve, reject) => {
					fail = reject;
				}),
			{ timeoutMs: 20, timeoutMessage: TIMEOUT },
		);
		await expect(run).rejects.toThrow(TIMEOUT);
		fail?.(new Error("the parser failed after we gave up"));
		await settle();
	});
});
