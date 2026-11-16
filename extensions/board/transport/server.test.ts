/**
 * The page's push: what reads the board, when, and what a change during a read does.
 *
 * The server is played by a fake mount that keeps the handler, so a case subscribes the
 * way a browser does — the stream route with the page's token, then `openSink` — and never
 * binds a port. The ticker and the coalescing window are injected, so "before any tick" is
 * an assertion about the signal rather than a race against a second of wall clock.
 */

import { describe, expect, test } from "bun:test";
import { boardWire, buildView, type BoardWire } from "../../../lib/workflow/view.ts";
import type { EventSink, HttpMount, LoopbackHandler, MountSource } from "../../../lib/http/index.ts";
import type { ArmTimer, RepeatTimer } from "../../../lib/timer.ts";
import { settle, waitFor } from "../../../test/helpers/process.ts";
import { billingCard } from "../../../test/helpers/fixtures/board.ts";
import { createBoardServer } from "./server.ts";
import type { WatchDirs } from "./watch.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";

/** The snapshot a case pushes: the card's revision is what makes a frame news. */
function snapshot(rev: number): BoardWire {
	return boardWire(
		buildView({
			me: { id: "s-lead", label: "billing-lead" },
			cards: [billingCard({ rev })],
			now: 1_000,
			bytes: 512,
			where: "board/abc123",
			repo: "my-pi-agent",
			root: "/Users/someone/my-pi-agent",
		}),
	);
}

/** A mount that keeps the handler, so the case plays the server with no socket. */
function fakeMount() {
	let handler: LoopbackHandler | undefined;
	let releases = 0;
	const source: MountSource = async (spec) => {
		handler = spec.handler;
		const mount: HttpMount = {
			base: spec.prefix,
			origin: "http://127.0.0.1:9",
			port: 9,
			release: async () => {
				releases += 1;
			},
			share: async () => undefined,
			unshare: async () => {},
		};
		return { kind: "mounted", mount };
	};
	return {
		source,
		handler: (): LoopbackHandler => {
			if (handler === undefined) throw new Error("the page mounted nothing");
			return handler;
		},
		releases: () => releases,
	};
}

/** A tab: the frames it was sent, and the detach the stream handed back. */
function recordingSink() {
	const frames: string[] = [];
	const sink: EventSink = {
		write: (frame) => {
			frames.push(frame);
		},
		end: () => {},
	};
	return { sink, frames };
}

/** The ticker a case drives by hand, remembering the cadence it was asked for. */
function ticker() {
	const ticks: (() => void)[] = [];
	const ms: number[] = [];
	const interval: RepeatTimer = (given, tick) => {
		ms.push(given);
		ticks.push(tick);
		return () => {};
	};
	return { interval, ms, tick: () => ticks[0]?.() };
}

/** The watch a case fires by hand, remembering the directories it was handed and its close. */
function watcher() {
	const changes: (() => void)[] = [];
	const dirs: (readonly string[])[] = [];
	let stops = 0;
	const watch: WatchDirs = (given, onChange) => {
		dirs.push(given);
		changes.push(onChange);
		return {
			stop: () => {
				stops += 1;
			},
		};
	};
	return { watch, dirs, fire: () => changes[0]?.(), stops: () => stops };
}

/** The idle-grace seam, which no case here exercises: a page with no tab waited on. */
const noTimer: ArmTimer = () => () => {};

/** A served page over a fake mount, its current revision, and the seams a case drives. */
async function harness(options: { dirs?: readonly string[]; stamp?: boolean } = {}) {
	const mount = fakeMount();
	let reads = 0;
	let rev = 1;
	/** The bus's cheap answer, which a case moves to say a file the page draws changed. */
	let busStamp = "s0";
	/** Reads still to fail, so a case can play a bus that cannot be read at all. */
	let failures = 0;
	/** While held, a read answers only when the case lets it: that is a push in flight. */
	let held = false;
	let open: (() => void) | undefined;
	const interval = ticker();
	const watch = watcher();
	const started = await createBoardServer({
		mount: mount.source,
		session: "s1",
		token: TOKEN,
		page: async () => "<html></html>",
		script: "",
		view: async () => {
			reads += 1;
			if (failures > 0) {
				failures -= 1;
				throw new Error("the board cannot be read");
			}
			// The revision is what this read answers with, taken before it waits.
			const current = rev;
			if (held) await new Promise<void>((resolve) => (open = resolve));
			return snapshot(current);
		},
		...(options.stamp === false ? {} : { stamp: async () => busStamp }),
		interval: interval.interval,
		timer: noTimer,
		...(options.dirs === undefined ? {} : { dirs: options.dirs, watch: watch.watch }),
	});
	if (started.kind !== "served") throw new Error(started.reason);
	return {
		server: started.server,
		mount,
		interval,
		watch,
		reads: () => reads,
		rev: (next: number) => {
			rev = next;
		},
		/** Say the bus's files moved, the way a message landing would. */
		stamp: (next: string) => {
			busStamp = next;
		},
		/** Fail the next `count` reads, and count them, the way a broken bus does. */
		fail: (count: number) => {
			failures = count;
		},
		/** Let the read in flight answer, and let the next one through. */
		hold: () => {
			held = true;
		},
		release: () => {
			held = false;
			open?.();
		},
		/** Open a tab the way a browser does, and wait for its first frame. */
		async attach() {
			const tab = recordingSink();
			const reply = await mount.handler()({
				method: "GET",
				url: `/events?token=${TOKEN}`,
				headers: { host: "127.0.0.1:9" },
				body: "",
			});
			expect(reply.result.stream).toBe(true);
			reply.openSink?.(tab.sink);
			await waitFor(() => tab.frames.length === 1);
			return tab;
		},
	};
}

describe("when a frame is read", () => {
	test("a watched change pushes before any tick", async () => {
		const page = await harness({ dirs: ["/board/cards"] });
		expect(page.watch.dirs).toEqual([["/board/cards"]]);
		// One tick a second either way: with a watch the stamp decides what a tick does.
		expect(page.interval.ms).toEqual([1_000]);
		const tab = await page.attach();
		page.rev(2);
		page.watch.fire();
		await waitFor(() => tab.frames.length === 2);
		expect(JSON.parse(tab.frames[1]?.replace("data: ", "") ?? "{}").sig).toBe(snapshot(2).sig);
		await page.server.close();
	});

	test("a page with no watch builds on every tick", async () => {
		const page = await harness();
		expect(page.interval.ms).toEqual([1_000]);
		const tab = await page.attach();
		page.rev(2);
		page.interval.tick();
		await waitFor(() => tab.frames.length === 2);
		// With no watch the tick is the only signal, so a stamp never stands between the two.
		page.rev(3);
		page.interval.tick();
		await waitFor(() => tab.frames.length === 3);
		await page.server.close();
	});

	test("a moved bus stamp pushes between sweeps", async () => {
		const page = await harness({ dirs: ["/board/cards"] });
		const tab = await page.attach();
		// A message landed: no card moved, so no watch fired, and the tick is the only way in.
		page.rev(2);
		page.stamp("s1");
		page.interval.tick();
		await waitFor(() => tab.frames.length === 2);
		expect(JSON.parse(tab.frames[1]?.replace("data: ", "") ?? "{}").sig).toBe(snapshot(2).sig);
		await page.server.close();
	});

	test("an unchanged stamp draws nothing until the sweep is due", async () => {
		const page = await harness({ dirs: ["/board/cards"] });
		const tab = await page.attach();
		expect(page.reads()).toBe(1);
		// Four ticks, spaced the way the product fires them, with nothing written in between: the
		// stamp is the whole question, and it is unchanged.
		for (let tick = 0; tick < 4; tick += 1) {
			page.interval.tick();
			await settle(5);
		}
		expect(page.reads()).toBe(1);
		// The fifth is the sweep, which reads even when no file moved: the clock decides some facts.
		page.interval.tick();
		await waitFor(() => page.reads() === 2);
		// The board said nothing new, so `sig` refuses the frame: a sweep is a read, not a repaint.
		expect(tab.frames.length).toBe(1);
		await page.server.close();
	});

	test("a build that threw is retried on the next tick, not at the sweep", async () => {
		const page = await harness({ dirs: ["/board/cards"] });
		const tab = await page.attach();
		page.rev(2);
		page.stamp("s1");
		page.fail(1);
		page.interval.tick();
		await waitFor(() => page.reads() === 2);
		await settle(10);
		// The stamp that failed was not recorded, so the same stamp is news again one tick later:
		// a bus nobody could read must not have to wait five seconds to be asked again.
		page.interval.tick();
		await waitFor(() => tab.frames.length === 2);
		expect(JSON.parse(tab.frames[1]?.replace("data: ", "") ?? "{}").sig).toBe(snapshot(2).sig);
		await page.server.close();
	});

	test("a bus write during a read is news on the next tick, not silence", async () => {
		const page = await harness({ dirs: ["/board/cards"] });
		const tab = await page.attach();
		page.rev(2);
		page.stamp("s1");
		page.hold();
		page.interval.tick();
		// The read is under way when the bus's files move again: the frame being built cannot
		// carry that write, so it must not be recorded as the stamp the page drew under either.
		await waitFor(() => page.reads() === 2);
		page.stamp("s2");
		page.release();
		await waitFor(() => tab.frames.length === 2);
		// Read the stamp first and this is a rebuild one tick later. Read it last, and the page has
		// already recorded a stamp its frame does not carry: that message waits for the sweep.
		page.interval.tick();
		await waitFor(() => page.reads() === 3);
		await page.server.close();
	});

	test("a change during a read is one more read and no second frame", async () => {
		const page = await harness({ dirs: ["/board/cards"] });
		const tab = await page.attach();
		page.rev(2);
		page.hold();
		page.watch.fire();
		// The first read is still running when the second change lands: it folds into one
		// more read once this one answers, rather than racing it to the tab.
		await waitFor(() => page.reads() === 2);
		page.watch.fire();
		page.release();
		await waitFor(() => page.reads() === 3);
		// One frame for the change: the folded read answered with the board already sent.
		expect(tab.frames.length).toBe(2);
		await page.server.close();
	});

	test("a tab that attaches late gets the current frame without a change", async () => {
		const page = await harness({ dirs: ["/board/cards"] });
		const first = await page.attach();
		page.rev(2);
		page.watch.fire();
		await waitFor(() => first.frames.length === 2);
		const late = await page.attach();
		expect(JSON.parse(late.frames[0]?.replace("data: ", "") ?? "{}").sig).toBe(snapshot(2).sig);
		await page.server.close();
	});

	test("close stops the signal, the sweep, and the mount", async () => {
		const page = await harness({ dirs: ["/board/cards"] });
		const tab = await page.attach();
		await page.server.close();
		expect(page.watch.stops()).toBe(1);
		expect(page.mount.releases()).toBe(1);
		page.rev(3);
		page.watch.fire();
		page.interval.tick();
		// Nothing arrives: the page is done, so a change and a tick have no reader to push to.
		expect(tab.frames.length).toBe(1);
	});
});
