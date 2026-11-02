/**
 * The page's own start mistakes and idle graces: a start that fails after its port is bound, a
 * page no tab ever opened, and one whose last tab left.
 *
 * The failed start is here rather than in `page.test.ts` because that suite is at its named
 * height, and the prefix it must give back is the page's own lifecycle, not a socket's answer.
 *
 * Both graces are wall-clock timers in the product — two minutes and one — and both cases
 * used to await a notification under a two-second `waitFor` budget, which turned an injected
 * twenty milliseconds into a bet on machine load: under `--parallel` on a busy box the wait
 * blew its budget on a tree that was fine (see #180). They fire the arm the page took
 * instead, through the one-shot seam the sink is built with.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { boardHarness } from "../../test/helpers/board.ts";
import { graceTimer } from "../../test/helpers/fixtures/http.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { testMountSource } from "../../test/helpers/serve.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createBoardPage, IDLE_FIRST_MS, IDLE_STOP_MS } from "./page.ts";
import { noteOf, servedPage } from "../../test/helpers/board-page.ts";
import { readPointer } from "../../lib/board/page-pointer.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 50_000;

/** The page this suite drives: a real server, no session behind it, and an injected grace. */
function harness(options: { firstIdleMs?: number; timer?: ReturnType<typeof graceTimer>["timer"] } = {}) {
	const board = boardHarness({ now: NOW, track: temps.track });
	const page = createBoardPage(board.runtime, {
		// A real server with no session behind it: the socket `serve` would have handed over.
		mount: testMountSource(),
		session: () => "s1",
		open: () => {},
		idleMs: 40,
		...(options.firstIdleMs === undefined ? {} : { firstIdleMs: options.firstIdleMs }),
		...(options.timer === undefined ? {} : { timer: options.timer }),
	});
	return { page, ctx: board.ctx, notifications: board.notifications, cwd: board.cwd, runtime: board.runtime };
}

describe("the idle grace", () => {
	test("closes the page once the last tab has been gone for the grace", async () => {
		// The grace is a minute in the product and the seam here, so the case fires the timer
		// the page armed rather than waiting a wall-clock slice for it.
		const grace = graceTimer();
		const { page, ctx, notifications } = harness({ timer: grace.timer });
		const status = servedPage(await page.start(ctx));
		expect(IDLE_STOP_MS).toBe(60_000);
		const token = new URL(status.url ?? "").searchParams.get("token") ?? "";
		const stream = await fetch(`http://127.0.0.1:${status.port}/board/events?token=${token}`);
		expect(stream.status).toBe(200);
		// The page has a reader; the grace must not be armed yet.
		await settle(150);
		expect((await page.status()).running).toBe(true);
		await stream.body?.cancel();
		// The first arm was stood down by the tab that attached, so the second is the one this
		// case is about: the grace waiting on the tab that has just left. Waiting for the close
		// the client just made is a real event and lands in milliseconds; the grace itself is
		// never waited for, because firing it is this case's job.
		await waitFor(() => grace.armed === 2 && grace.cancelled === 1);
		grace.fire();
		await waitFor(() => notifications.length > 0);
		await settle();
		expect((await page.status()).running).toBe(false);
		expect(notifications).toContain("board: stopped — the last page was closed");
	});
});

describe("a page no tab ever opened", () => {
	test("closes on its first grace, and says which grace it was", async () => {
		const grace = graceTimer();
		const { page, ctx, notifications, cwd, runtime } = harness({ firstIdleMs: 20, timer: grace.timer });
		const status = servedPage(await page.start(ctx));
		// Two minutes in the product, twenty milliseconds here: the same path, and the seam
		// fires the arm the page took rather than waiting out either number.
		expect(IDLE_FIRST_MS).toBe(120_000);
		// The browser never came up: no stream is opened against this page at all.
		expect(grace.armed).toBe(1);
		grace.fire();
		await waitFor(() => notifications.length > 0);
		await settle();
		expect((await page.status()).running).toBe(false);
		expect(notifications).toContain("board: stopped — no tab ever opened; /board starts it again");
		// And nothing is left behind for the next session to probe.
		expect(await noteOf(runtime, cwd)).toBeUndefined();
		await expect(fetch(status.url ?? "")).rejects.toBeDefined();
	});
});

describe("a start that fails after the port is bound", () => {
	test("gives the prefix back, so the next /board serves instead of being refused", async () => {
		const board = boardHarness({ now: NOW, track: temps.track });
		const store = await board.runtime.store(board.cwd);
		const base = testMountSource();
		let mounts = 0;
		const page = createBoardPage(board.runtime, {
			// The note is a write beside the cards, so the first mount turns the board's directory
			// into a file: `settlePointer` rethrows every fs error but EEXIST, and the mount exists
			// by then. The second mount is the `/board` the case is asking to succeed.
			mount: async (spec) => {
				const mounted = await base(spec);
				if (mounts++ > 0) return mounted;
				rmSync(store.dir, { recursive: true, force: true });
				writeFileSync(store.dir, "");
				return mounted;
			},
			session: () => "s1",
			open: () => {},
			idleMs: 40,
		});

		const start = await page.start(board.ctx);
		expect(start.kind).toBe("failed");
		expect(board.notifications.join("\n")).toContain("board: the page did not start");
		// The page was never announced, so nothing else would ever close it: no seat, no note, and
		// no mount holding /board on the session's server.
		expect((await page.status()).running).toBe(false);
		expect(await readPointer(store.dir)).toBeUndefined();
		// The directory can take a note again, and the prefix is free: a leaked mount would answer
		// refused here, and every later `/board` in the session would say already served.
		rmSync(store.dir, { force: true });
		mkdirSync(store.dir, { recursive: true });
		servedPage(await page.start(board.ctx));
		await page.stop();
	});
});
