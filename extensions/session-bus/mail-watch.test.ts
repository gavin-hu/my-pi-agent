/**
 * The armed inbox watch: what it queues, what it wakes, and what leaves the queue.
 *
 * These cases drive the shipped store and watch together, without a runtime or a
 * session. The watch asks the inbox two questions — what is new, and what is still
 * there — and both are answered by the directory, so a case can put the inbox in a
 * state a session would be slow to reach. The told set is the fixture's, as the
 * record is the runtime's: the watch holds no copy of its own.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitFor } from "../../test/helpers/process.ts";
import { createMailWatch, type MailWatch, storedWatchMode, watchModeOf, watchPair } from "./mail-watch.ts";
import { MAX_LIMIT } from "./protocol.ts";
import { createBusStore, type BusStore } from "./store.ts";
import type { BusMessage, WatchMode } from "./types.ts";
import { untoldOf } from "../../test/helpers/bus.ts";

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
	/** Reads the watch has made of the inbox. */
	peeks(): number;
	/** The told set the watch has written back, which a record would hold. */
	told(): string[];
	/** Put an id in the told set, as a record that outlived its process would. */
	remember(id: string): void;
	/** Whether a read is parked at the gate, so `release()` has something to open. */
	held(): boolean;
	/** Open the gate a held read waits on; a no-op when the fixture holds none. */
	release(): void;
}

/**
 * A store, an armed watch over one inbox, and no ticker: every case polls by hand.
 *
 * `hold` puts every read behind a gate this case opens with {@link Fixture.release}, which
 * is how two polls are made to overlap exactly — no timer, no guessed delay.
 */
async function fixture(options: { hold?: boolean } = {}): Promise<Fixture> {
	const dir = mkdtempSync(join(tmpdir(), "pi-mail-watch-"));
	dirs.push(dir);
	const store = createBusStore({ dir });
	const wakes: number[] = [];
	const held = options.hold === true;
	let peeks = 0;
	let told: string[] = [];
	let open: (() => void) | undefined;
	const watch = createMailWatch({
		peek: async (known) => {
			peeks += 1;
			const page = await store.peek("s2", { limit: MAX_LIMIT, known });
			// Held after the read, so a case can act on the inbox in the window between the
			// page being taken and the watch appending it.
			if (held) {
				await new Promise<void>((resolve) => {
					open = resolve;
				});
			}
			return page;
		},
		told: () => told,
		onTold: (ids) => {
			told = [...ids];
		},
		interval: () => () => {},
		watchMs: 0,
	});
	watch.onWake = () => wakes.push(wakes.length + 1);
	return {
		store,
		watch,
		wakes,
		peeks: () => peeks,
		told: () => [...told],
		remember: (id) => {
			told = [...told, id];
		},
		held: () => open !== undefined,
		release: () => {
			open?.();
			open = undefined;
		},
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
		expect(await untoldOf(target.store.dir, "s2")).toBe(56);
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

	test("reports the ids it announced, so the caller's record is the only copy", async () => {
		const target = await fixture();
		await fill(target, 1_000, 2);
		await target.watch.watch({});
		expect(target.told()).toEqual([]);
		target.watch.markReported(target.watch.pending().map((message) => message.id));
		expect(target.told()).toEqual(["1000-a", "1001-a"]);
	});

	test("queues nothing it was already told about, and reports the ids whose files are gone", async () => {
		const target = await fixture();
		await fill(target, 1_000, 2);
		// A record that outlived its process: the watch starts from what it already says.
		target.remember("1000-a");
		await target.watch.watch({});
		expect(target.watch.pending().map((message) => message.id)).toEqual(["1001-a"]);
		// The mail behind a told id leaves the inbox — consumed, or expired — and the next poll
		// writes back the shorter set, which is the number a peer counts.
		await target.store.inbox("s2", 1);
		await target.watch.poll();
		expect(target.told()).toEqual([]);
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
		// before every message already on the bus, however late it arrives — and the queue is the
		// arrival, so it sits behind a full page. A window taken from one end of the inbox can
		// hide it; the ids the watch has not announced cannot.
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

	test("queues a message once when a tick and a poll overlap", async () => {
		const target = await fixture({ hold: true });
		await target.write(1_000);
		const arming = target.watch.watch({ wake: true });
		expect(target.peeks()).toBe(1);
		// A tick beside the read in flight: dropped, not queued behind it, so two readers
		// cannot compute the same `known` and append the same mail.
		const second = target.watch.poll();
		expect(target.peeks()).toBe(1);

		await waitFor(() => target.held());
		target.release();
		await Promise.all([arming, second]);
		expect(target.watch.pending().map((message) => message.id)).toEqual(["1000-a"]);
		expect(target.wakes).toHaveLength(1);
	});

	test("does not queue mail consumed while the poll was reading", async () => {
		const target = await fixture({ hold: true });
		await target.write(1_000);
		const arming = target.watch.watch({});
		await waitFor(() => target.held());

		// The model's own `inbox` call lands between the read and the append: the page this
		// poll is carrying names a message this session already has.
		const consumed = await target.store.inbox("s2", 10);
		target.watch.markReported(consumed.messages.map((message) => message.id));

		target.release();
		await arming;
		expect(target.watch.pending()).toEqual([]);
	});

	test("queues nothing from a read that returns after the watch stopped", async () => {
		const target = await fixture({ hold: true });
		await target.write(1_000);
		const arming = target.watch.watch({});
		await waitFor(() => target.held());
		await target.watch.watch({ stop: true });

		target.release();
		await arming;
		expect(target.watch.pending()).toEqual([]);
		expect(target.watch.state()).toEqual({ armed: false, wake: false });
	});

	test("remembers the depth of the last read, and forgets it when disarmed", async () => {
		const target = await fixture();
		await fill(target, 1_000, 2);
		await target.watch.watch({});
		expect(target.watch.size()).toBe(2);
		// Consuming a file changes the depth without changing what was announced.
		await target.store.inbox("s2", 1);
		await target.watch.poll();
		expect(target.watch.size()).toBe(1);
		await target.watch.watch({ stop: true });
		expect(target.watch.size()).toBe(0);
	});

	test("queues nothing while it is disarmed", async () => {
		const target = await fixture();
		await target.write(1_000);
		await target.watch.poll();
		expect(target.watch.pending()).toEqual([]);
		expect(target.wakes).toEqual([]);
	});
});

describe("the mode a record carries", () => {
	test("is one of three, and the pair a peer reads is its rendering", () => {
		expect([watchPair("off"), watchPair("on"), watchPair("wake")]).toEqual([
			{ armed: false, wake: false },
			{ armed: true, wake: false },
			{ armed: true, wake: true },
		]);
		expect(["off", "on", "wake"].map((mode) => watchModeOf(watchPair(mode as WatchMode)))).toEqual([
			"off",
			"on",
			"wake",
		]);
	});

	test("reads a legacy pair, and the pair that cannot be a mode reads as off", () => {
		expect(watchModeOf(undefined)).toBe("off");
		expect(watchModeOf({ armed: true, wake: false })).toBe("on");
		expect(watchModeOf({ armed: true, wake: true })).toBe("wake");
		// A watch that is not armed delivers nothing, whatever its wake flag says: this build
		// never wrote such a pair, so only a hand edit can hold one.
		expect(watchModeOf({ armed: false, wake: true })).toBe("off");
	});

	test("a record's own field is the mode, and the pair beside it is for a peer", () => {
		expect(storedWatchMode({ watch: "wake", watching: { armed: true, wake: true } })).toBe("wake");
		// The field is the statement; the pair is a view. A record that disagrees is adopted from
		// the statement and read by a peer through the view.
		expect(storedWatchMode({ watch: "off", watching: { armed: true, wake: true } })).toBe("off");
		expect(storedWatchMode({ watching: { armed: true, wake: true } })).toBe("wake");
		expect(storedWatchMode(undefined)).toBe("off");
		// A field that is not a mode is not a reason to lose the record: the pair still answers,
		// and with neither there is nothing to arm.
		const edited = { watch: "listening", watching: { armed: true, wake: false } } as unknown as {
			watch: WatchMode;
			watching: { armed: boolean; wake: boolean };
		};
		expect(storedWatchMode(edited)).toBe("on");
	});
});

describe("the mode a start restores", () => {
	test("arms the mode the record carries", async () => {
		const target = await fixture();
		await target.watch.restore("wake");
		expect(target.watch.state()).toEqual({ armed: true, wake: true });
		expect(target.watch.wantsWake()).toBe(true);
	});

	test("arms an on record without wake, and polls for it", async () => {
		const target = await fixture();
		await target.watch.restore("on");
		expect(target.watch.state()).toEqual({ armed: true, wake: false });
		expect(target.watch.wantsWake()).toBe(false);
		expect(target.peeks()).toBe(1);
	});

	test("does not arm a record that says off", async () => {
		const target = await fixture();
		await target.write(1_000);
		await target.watch.restore("off");
		expect(target.watch.state()).toEqual({ armed: false, wake: false });
		expect(target.peeks()).toBe(0);
		expect(target.watch.pending()).toEqual([]);
	});

	test("stands down once a join in this run has decided", async () => {
		const target = await fixture();
		// A door spoke before the start could adopt: the record it wrote is newer than the one
		// the start read, so adopting over it would undo the door.
		await target.watch.watch({ wake: false });
		await target.watch.restore("wake");
		expect(target.watch.state()).toEqual({ armed: true, wake: false });
	});

	test("a plain join after the restore keeps the wake the record asked for", async () => {
		const target = await fixture();
		await target.watch.restore("wake");
		expect(await target.watch.watch({})).toEqual({ armed: true, wake: true });
		// An explicit demotion is still a door's to make, and it survives as `on`.
		expect(await target.watch.watch({ wake: false })).toEqual({ armed: true, wake: false });
		expect(await target.watch.watch({})).toEqual({ armed: true, wake: false });
	});
});
