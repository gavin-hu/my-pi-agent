/**
 * The page's push: what reads the board, when, and what a change during a read does.
 *
 * The server is played by a fake mount that keeps the handler, so a case subscribes the
 * way a browser does — the stream route with the page's token, then `openSink` — and never
 * binds a port. The ticker and the coalescing window are injected, so "before any tick" is
 * an assertion about the signal rather than a race against a second of wall clock.
 */

import { describe, expect, test } from "bun:test";
import { buildView, type BoardView } from "../../../lib/board/view.ts";
import type { EventSink, HttpMount, LoopbackHandler, MountSource } from "../../../lib/http/index.ts";
import type { ArmTimer, RepeatTimer } from "../../../lib/timer.ts";
import { waitFor } from "../../../test/helpers/process.ts";
import { billingCard } from "../../../test/helpers/fixtures/board.ts";
import { createBoardServer } from "./server.ts";
import type { WatchDirs } from "./watch.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";

/** The snapshot a case pushes: the card's revision is what makes a frame news. */
function snapshot(rev: number): BoardView {
	return buildView({
		me: { id: "s-lead", label: "billing-lead" },
		cards: [billingCard({ rev })],
		now: 1_000,
		bytes: 512,
		where: "board/abc123",
		repo: "my-pi-agent",
		root: "/Users/someone/my-pi-agent",
	});
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
async function harness(options: { dirs?: readonly string[] } = {}) {
	const mount = fakeMount();
	let reads = 0;
	let rev = 1;
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
			// The revision is what this read answers with, taken before it waits.
			const current = rev;
			if (held) await new Promise<void>((resolve) => (open = resolve));
			return snapshot(current);
		},
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
		expect(page.interval.ms).toEqual([5_000]);
		const tab = await page.attach();
		page.rev(2);
		page.watch.fire();
		await waitFor(() => tab.frames.length === 2);
		expect(JSON.parse(tab.frames[1]?.replace("data: ", "") ?? "{}").sig).toBe(snapshot(2).sig);
		await page.server.close();
	});

	test("a page with no watch sweeps at a second, and a tick pushes", async () => {
		const page = await harness();
		expect(page.interval.ms).toEqual([1_000]);
		const tab = await page.attach();
		page.rev(2);
		page.interval.tick();
		await waitFor(() => tab.frames.length === 2);
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
