import { describe, expect, test } from "bun:test";
import { settle } from "../../test/helpers/process.ts";
import { createReplyPipeline } from "./reply-pipeline.ts";

function harness(options: { partChars?: number; quietMs?: number } = {}) {
	const parts: string[] = [];
	const timers: Array<{ fn: () => void }> = [];
	const pipeline = createReplyPipeline({
		sendPart: async (text) => {
			parts.push(text);
		},
		armTimer: (_ms, fn) => {
			// Only the latest quiet timer matters, like a real one-shot.
			const entry = { fn };
			timers.push(entry);
			return () => {
				const index = timers.indexOf(entry);
				if (index >= 0) timers.splice(index, 1);
			};
		},
		partChars: options.partChars,
		quietMs: options.quietMs,
	});
	return {
		pipeline,
		parts,
		/** Fire the pending quiet timer, as two silent seconds would. */
		quiet: () => {
			const pending = timers.splice(0);
			for (const timer of pending) timer.fn();
		},
		pending: () => timers.length,
	};
}

describe("reply pipeline", () => {
	test("sends each paragraph as it completes, then the remainder", async () => {
		const { pipeline, parts } = harness();
		pipeline.push("first para\n\n");
		await settle();
		pipeline.push("second para");
		expect(parts).toEqual(["first para"]);
		await pipeline.finish();
		expect(parts).toEqual(["first para", "second para"]);
		expect(pipeline.text()).toBe("first para\n\nsecond para");
	});

	test("flushes after a quiet period inside a paragraph", async () => {
		const { pipeline, parts, quiet } = harness();
		pipeline.push("half a thought");
		expect(parts).toEqual([]);
		quiet();
		await pipeline.finish();
		expect(parts).toEqual(["half a thought"]);
	});

	test("caps a part that runs long and breaks on a word boundary", async () => {
		const { pipeline, parts } = harness({ partChars: 20 });
		pipeline.push("alpha beta gamma delta epsilon");
		await settle();
		// The first part is cut at a space, not mid-word.
		expect(parts[0]).toBe("alpha beta gamma");
		await pipeline.finish();
		expect(parts.join(" ")).toBe("alpha beta gamma delta epsilon");
	});

	test("never sends an empty or whitespace-only part", async () => {
		const { pipeline, parts } = harness();
		pipeline.push("\n\n   \n\n");
		await pipeline.finish();
		expect(parts).toEqual([]);
		expect(pipeline.sent()).toBe("");
	});

	test("drop discards the unsent remainder but keeps what went out", async () => {
		const { pipeline, parts } = harness();
		pipeline.push("sent\n\n");
		await settle();
		pipeline.push("never sent");
		pipeline.drop();
		await pipeline.finish();
		expect(parts).toEqual(["sent"]);
		expect(pipeline.text()).toBe("sent\n\nnever sent");
		expect(pipeline.sent()).toBe("sent");
	});

	test("sends parts strictly in order even when a send is slow", async () => {
		const parts: string[] = [];
		let release: (() => void) | undefined;
		const pipeline = createReplyPipeline({
			sendPart: async (text) => {
				if (text === "one") await new Promise<void>((resolve) => (release = resolve));
				parts.push(text);
			},
			armTimer: () => () => {},
		});
		pipeline.push("one\n\n");
		pipeline.push("two\n\n");
		pipeline.push("three");
		const finished = pipeline.finish();
		await settle();
		// The second send waits for the first, so nothing overtakes it.
		expect(parts).toEqual([]);
		release?.();
		await finished;
		expect(parts).toEqual(["one", "two", "three"]);
	});

	test("sent() reports text handed to the transport, even when a send is rejected", async () => {
		const pipeline = createReplyPipeline({
			// `sent()` answers "did the turn produce text to send", not "was it
			// delivered"; a rejected part is a transport failure the bridge reports.
			sendPart: async () => undefined,
			armTimer: () => () => {},
		});
		pipeline.push("produced\n\n");
		await settle();
		await pipeline.finish();
		expect(pipeline.sent()).toBe("produced");
	});
});
