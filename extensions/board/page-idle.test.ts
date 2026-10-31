/**
 * The page's idle grace: a page no tab ever opened, and one whose last tab left.
 *
 * Both graces are wall-clock timers in the product — two minutes and one — and both cases
 * used to await a notification under a two-second `waitFor` budget, which turned an injected
 * twenty milliseconds into a bet on machine load: under `--parallel` on a busy box the wait
 * blew its budget on a tree that was fine (see #180). They fire the arm the page took
 * instead, through the one-shot seam the sink is built with.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { boardHarness } from "../../test/helpers/board.ts";
import { graceTimer } from "../../test/helpers/fixtures/http.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { testMountSource } from "../../test/helpers/serve.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createBoardPage, IDLE_FIRST_MS, IDLE_STOP_MS } from "./page.ts";
import { noteOf, servedPage } from "../../test/helpers/board-page.ts";

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
