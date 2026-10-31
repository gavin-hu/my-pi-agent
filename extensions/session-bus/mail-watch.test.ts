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
		peek: (known) => store.peek("s2", { limit: MAX_LIMIT, known }),
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
	test("queues a handoff that arrives behind a backlog deeper than one page", async () => {
		const target = await fixture();
		await fill(target, 1_000, 55);
		await target.watch.watch({ wake: true });
		expect(target.watch.pending()).toHaveLength(MAX_LIMIT);
		target.watch.markReported(target.watch.pending().map((message) => message.id));
		const announced = target.wakes.length;

		// The first page left five behind. The handoff is the newest of them all, and the notice
		// is the only delivery for a session that is not calling `inbox`, so it is announced with
		// the rest of the backlog instead of waiting for a consume.
		await target.write(2_000, "handoff");
		await target.watch.poll();
		expect(target.watch.pending().map((message) => message.text)).toEqual([
			"mail 1050",
			"mail 1051",
			"mail 1052",
			"mail 1053",
			"mail 1054",
			"mail 2000",
		]);
		expect(target.wakes).toHaveLength(announced + 1);
		// Announced, not consumed: the mail is still unread, and `inbox` still owns deleting it.
		expect(await target.store.unread("s2")).toBe(56);
	});

	test("keeps a queue older than the page the poll reads", async () => {
		const target = await fixture();
		await target.watch.watch({});
		await fill(target, 1_000, 50);
		await target.watch.poll();
		expect(target.watch.pending()).toHaveLength(50);

		// The second burst is past the first page. The first burst is unreported work, so it
		// stays queued: a page is what one poll reads, not what the inbox holds.
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

	test("queues a handoff whose id sorts before everything already on the bus", async () => {
		const target = await fixture();
		await fill(target, 1_500_000, 50);
		await target.watch.watch({ wake: true });
		target.watch.markReported(target.watch.pending().map((message) => message.id));
		const announced = target.wakes.length;

		// The id carries the writer's clock, so a peer running behind writes one that sorts
		// before every message already on the bus, however late it arrives. A window taken from
		// one end of the inbox can hide it; the ids the watch has not announced cannot.
		await target.write(1_400_000, "handoff");
		await target.watch.poll();
		expect(target.watch.pending().map((message) => message.text)).toEqual(["mail 1400000"]);
		expect(target.wakes).toHaveLength(announced + 1);
	});

	test("announces a backlog past the memory a count would keep, and never twice", async () => {
		const target = await fixture();
		await fill(target, 1_000_000, 260);
		await target.watch.watch({});
		// One page a poll, and the reporter drains the queue after each notice, as
		// `lib/report.ts` does: the whole backlog is announced once, in order, rather than its
		// front being announced again because a count had aged it out.
		const announced: string[] = [];
		for (let page = 0; page < 6; page += 1) {
			await target.watch.poll();
			const ids = target.watch.pending().map((message) => message.id);
			announced.push(...ids);
			target.watch.markReported(ids);
		}
		expect(announced).toHaveLength(260);
		expect(new Set(announced).size).toBe(260);
		// Every one of them is still unread on disk, and none is announced a second time.
		await target.watch.poll();
		expect(target.watch.pending()).toEqual([]);
	});

	test("queues nothing while it is disarmed", async () => {
		const target = await fixture();
		await target.write(1_000);
		await target.watch.poll();
		expect(target.watch.pending()).toEqual([]);
		expect(target.wakes).toEqual([]);
	});
});
