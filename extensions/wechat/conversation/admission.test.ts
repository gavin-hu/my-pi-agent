/**
 * The hourly turn budget and the serial admission chain: what the chat may spend,
 * the order its own messages are resolved in, and `settled()` — the promise the poll
 * loop awaits before it acknowledges the batch it just fed in.
 *
 * Acknowledging early is what loses a message to a kill during a media download, so
 * the promise has to mean "every admission in flight is done", not "the queue is idle
 * right now".
 */

import { describe, expect, test } from "bun:test";
import { makeClock, type Clock } from "../../../test/helpers/clock.ts";
import { settle } from "../../../test/helpers/process.ts";
import { createAdmissionQueue, createTurnBudget, type TurnBudget } from "./admission.ts";
import type { InboundItem } from "../types.ts";

const ITEM: InboundItem = { peer: "alice@im.wechat", text: "one", media: [], language: "en" };

function inboundItem(text: string, peer = "alice@im.wechat"): InboundItem {
	return { peer, text, media: [], language: "en" };
}

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
		expect(queue.pending()).toBe(0);
	});

	test("settles at once with nothing in flight", async () => {
		// The loop asks after every batch, including an empty one, so this must not hang.
		const { queue } = harness();
		await queue.settled();
		expect(queue.pending()).toBe(0);
	});
});

describe("turn budget", () => {
	function budget(limit: number, clock: Clock): TurnBudget {
		return createTurnBudget(limit, clock.now);
	}

	test("allows every turn when the cap is off", () => {
		const clock = makeClock(1000);
		const turns = budget(0, clock);
		for (let index = 0; index < 20; index++) expect(turns.allow()).toBe(true);
	});

	test("refuses a turn past the rolling-hour allowance", () => {
		const clock = makeClock(1000);
		const turns = budget(2, clock);
		expect(turns.allow()).toBe(true);
		expect(turns.allow()).toBe(true);
		expect(turns.allow()).toBe(false);
	});

	test("frees the allowance as the hour rolls", () => {
		const clock = makeClock(1000);
		const turns = budget(1, clock);
		expect(turns.allow()).toBe(true);
		clock.advance(60 * 60 * 1000 + 1);
		expect(turns.allow()).toBe(true);
	});

	test("reset starts a fresh window", () => {
		const clock = makeClock(1000);
		const turns = budget(1, clock);
		expect(turns.allow()).toBe(true);
		turns.reset();
		expect(turns.allow()).toBe(true);
	});
});

describe("admission queue", () => {
	function admissionHarness() {
		const admitted: string[] = [];
		const notices: string[] = [];
		let releaseSlow: (() => void) | undefined;
		const slow = new Promise<void>((resolve) => {
			releaseSlow = resolve;
		});
		const queue = createAdmissionQueue({
			admit: async (item) => {
				admitted.push(item.text);
				if (item.text === "slow") await slow;
				if (item.text === "bad") throw new Error("download failed");
			},
			notify: (message) => notices.push(message),
		});
		return {
			queue,
			admitted,
			notices,
			release: () => releaseSlow?.(),
		};
	}

	test("admits messages in arrival order even when the first is slow", async () => {
		const { queue, admitted, release } = admissionHarness();
		queue.enqueue(inboundItem("slow"));
		queue.enqueue(inboundItem("fast"));
		await settle();
		expect(admitted).toEqual(["slow"]);
		expect(queue.pending()).toBe(2);

		release();
		await settle();
		expect(admitted).toEqual(["slow", "fast"]);
		expect(queue.pending()).toBe(0);
	});

	test("reports a failed admission and keeps the chain moving", async () => {
		const { queue, admitted, notices } = admissionHarness();
		queue.enqueue(inboundItem("bad"));
		queue.enqueue(inboundItem("after"));
		await settle();
		await settle();
		expect(admitted).toEqual(["bad", "after"]);
		expect(notices[0]).toContain("download failed");
		expect(queue.pending()).toBe(0);
	});

	test("reset drops the reserved slots", async () => {
		const { queue, release } = admissionHarness();
		queue.enqueue(inboundItem("slow"));
		await settle();
		expect(queue.pending()).toBe(1);
		queue.reset();
		expect(queue.pending()).toBe(0);
		release();
	});

	test("drain drops a download in flight instead of handing it over", async () => {
		const handed: string[] = [];
		const live: boolean[] = [];
		let releaseDownload: (() => void) | undefined;
		const download = new Promise<void>((resolve) => {
			releaseDownload = resolve;
		});
		let releaseTail: (() => void) | undefined;
		const tail = new Promise<void>((resolve) => {
			releaseTail = resolve;
		});
		const queue = createAdmissionQueue({
			admit: async (item, alive) => {
				if (item.text === "slow") await tail;
				await download;
				live.push(alive());
				if (alive()) handed.push(item.text);
			},
			notify: () => {},
		});
		queue.enqueue(inboundItem("held"));
		queue.enqueue(inboundItem("slow"));
		await settle();
		expect(queue.pending()).toBe(2);

		// The chat's `/stop` lands while the first download is in flight: both go.
		expect(queue.drain()).toBe(2);
		expect(queue.pending()).toBe(0);
		// The loop's acknowledgement must not wait on a message the stop took.
		await queue.settled();

		releaseDownload?.();
		releaseTail?.();
		await settle();
		await settle();
		// The admission already in `admit` stood down at its own check, and the one still
		// waiting for its turn in the chain never reached `admit` at all.
		expect(live).toEqual([false]);
		expect(handed).toEqual([]);
		expect(queue.pending()).toBe(0);
	});

	test("a message admitted after a drain is handed over", async () => {
		const handed: string[] = [];
		const queue = createAdmissionQueue({
			admit: async (item, alive) => {
				if (alive()) handed.push(item.text);
			},
			notify: () => {},
		});
		queue.enqueue(inboundItem("dropped"));
		queue.drain();
		queue.enqueue(inboundItem("after"));
		await queue.settled();
		expect(handed).toEqual(["after"]);
		expect(queue.pending()).toBe(0);
	});
});
