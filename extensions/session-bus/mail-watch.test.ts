/**
 * The armed inbox watch: what it queues, what it wakes, and what leaves the queue.
 *
 * These cases drive the shipped store and watch together, without a runtime or a
 * session. The watch asks the inbox two questions — what is new, and what is still
 * there — and both are answered by the directory, so a case can put the inbox in a
 * state a session would be slow to reach.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMailWatch, type MailWatch } from "./mail-watch.ts";
import { MAX_LIMIT } from "./protocol.ts";
import { createBusStore, type BusStore } from "./store.ts";
import type { BusMessage } from "./types.ts";

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
	store: BusStore;
	watch: MailWatch;
	/** One entry per wake the watch raised. */
	wakes: number[];
	/** Put one message in this session's inbox, named so it sorts by `at`. */
	write(at: number, kind?: BusMessage["kind"]): Promise<void>;
}

/** A store, an armed watch over one inbox, and no ticker: every case polls by hand. */
async function fixture(): Promise<Fixture> {
	const dir = mkdtempSync(join(tmpdir(), "pi-mail-watch-"));
	dirs.push(dir);
	const store = createBusStore({ dir });
	const wakes: number[] = [];
	const watch = createMailWatch({
		peek: () => store.peek("s2", MAX_LIMIT),
		interval: () => () => {},
		watchMs: 0,
	});
	watch.onWake = () => wakes.push(wakes.length + 1);
	return {
		store,
		watch,
		wakes,
		write: (at, kind = "message") =>
			store.writeMessage("s2", {
				id: `${at}-a`,
				from: "s1",
				fromLabel: "peer",
				to: "s2",
				toLabel: "me",
				kind,
				text: `mail ${at}`,
				at,
			}),
	};
}

/** Fill an inbox with `count` messages, an inbox-order window plus whatever is asked. */
async function fill(target: Fixture, from: number, count: number): Promise<void> {
	for (let index = 0; index < count; index += 1) await target.write(from + index);
}

describe("the armed inbox watch", () => {
	test("queues a handoff that arrives behind a backlog deeper than one read", async () => {
		const target = await fixture();
		await fill(target, 1_000, 55);
		await target.watch.watch({ wake: true });
		expect(target.watch.pending()).toHaveLength(MAX_LIMIT);
		target.watch.markReported(target.watch.pending().map((message) => message.id));
		const announced = target.wakes.length;

		// A handoff sorts last, so an oldest-first read cannot see it: the notice is the only
		// delivery for a session that is not calling `inbox`, so it must not wait for one.
		await target.write(2_000, "handoff");
		await target.watch.poll();
		expect(target.watch.pending().map((message) => message.text)).toEqual(["mail 2000"]);
		expect(target.wakes).toHaveLength(announced + 1);
		// Announced, not consumed: the mail is still unread, and `inbox` still owns deleting it.
		expect(await target.store.unread("s2")).toBe(56);
	});

	test("keeps a queue older than the window the poll reads", async () => {
		const target = await fixture();
		await target.watch.watch({});
		await fill(target, 1_000, 50);
		await target.watch.poll();
		expect(target.watch.pending()).toHaveLength(50);

		// The second burst fills the window with itself. The first burst is unreported work,
		// so it stays queued: the window is what one poll reads, not what the inbox holds.
		await fill(target, 2_000, 50);
		await target.watch.poll();
		expect(target.watch.pending()).toHaveLength(100);
		expect(target.wakes).toEqual([]);
	});

	test("drops a message from the queue once its file is gone", async () => {
		const target = await fixture();
		await target.write(1_000);
		await target.write(1_001);
		await target.watch.watch({});
		expect(target.watch.pending()).toHaveLength(2);

		// Consumed by a reader that did not mark it reported, or expired: either way the mail
		// left the inbox with its file, so there is nothing left to announce.
		await target.store.inbox("s2", 1);
		await target.watch.poll();
		expect(target.watch.pending().map((message) => message.id)).toEqual(["1001-a"]);
	});

	test("queues nothing while it is disarmed", async () => {
		const target = await fixture();
		await target.write(1_000);
		await target.watch.poll();
		expect(target.watch.pending()).toEqual([]);
		expect(target.wakes).toEqual([]);
	});
});
