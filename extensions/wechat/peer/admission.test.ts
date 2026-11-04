/**
 * The per-peer admission chain, seen from the poll loop: a peer's messages are
 * resolved one at a time and in arrival order, and `settled()` is the promise the loop
 * awaits before it acknowledges the batch it just fed in.
 *
 * Acknowledging early is what loses a message to a kill during a media download, so
 * the promise has to mean "every admission in flight is done", not "the queue is idle
 * right now".
 */

import { describe, expect, test } from "bun:test";
import { settle } from "../../../test/helpers/process.ts";
import { createAdmissionQueue } from "./admission.ts";
import type { InboundItem } from "../types.ts";

const ITEM: InboundItem = { peer: "alice@im.wechat", text: "one", media: [], language: "en" };

describe("the admission queue", () => {
	function harness() {
		const admitted: string[] = [];
		let release: (() => void) | undefined;
		const slow = new Promise<void>((resolve) => {
			release = resolve;
		});
		const queue = createAdmissionQueue({
			admit: async (item) => {
				admitted.push(item.text);
				await slow;
			},
			notify: () => {},
		});
		return { queue, admitted, release: () => release?.() };
	}

	test("settles only once the admission in flight has finished", async () => {
		const { queue, release } = harness();
		let settled = false;
		queue.enqueue(ITEM);
		void queue.settled().then(() => {
			settled = true;
		});

		await settle();
		expect(settled).toBe(false);

		release();
		await queue.settled();
		expect(settled).toBe(true);
		expect(queue.pending(ITEM.peer)).toBe(0);
	});

	test("settles at once for a peer with nothing in flight", async () => {
		// The loop asks after every batch, including an empty one, so this must not hang.
		const { queue } = harness();
		await queue.settled();
		expect(queue.pending(ITEM.peer)).toBe(0);
	});
});
