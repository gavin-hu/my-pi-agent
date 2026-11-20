/**
 * The tab a page opens, or does not: the switch, the turn's locality, and a launcher
 * that fails.
 *
 * The page's lifecycle and the socket are `page.test.ts`'s; this suite is the one
 * decision the page makes about a browser, driven through the launcher seam so no case
 * starts one.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { boardHarness } from "../../test/helpers/board.ts";
import { recordingLaunch } from "../../test/helpers/launcher.ts";
import { markRemote, quietChannel } from "../../test/helpers/remote-ui.ts";
import { testMountSource } from "../../test/helpers/serve.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { servedPage } from "../../test/helpers/board-page.ts";
import { createBoardPage } from "./page.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 50_000;

/**
 * A page over a temp board, with the tab recorded instead of opened.
 *
 * `serve` is the project's `serve` section — the page's own switch — and `launch` is the
 * seam a case drives to a failure; a case passes one or the other, never both, because
 * the opener takes one launcher.
 */
function harness(
	options: { serve?: Record<string, unknown>; launch?: ReturnType<typeof recordingLaunch>["launch"] } = {},
) {
	const board = boardHarness({ now: NOW, track: temps.track, ...options });
	const opened: string[] = [];
	const page = createBoardPage(board.runtime, {
		// A real server with no session behind it: the socket `serve` would have handed over.
		mount: testMountSource(),
		session: () => "s1",
		...(options.launch === undefined ? { open: (url: string) => opened.push(url) } : { launch: options.launch }),
		idleMs: 40,
	});
	return { page, ctx: board.ctx, opened, notifications: board.notifications };
}

describe("the page's tab", () => {
	test("names the launcher's reason when the page served and no tab opened", async () => {
		const { launch, child } = recordingLaunch();
		const { page, ctx, notifications } = harness({ launch });
		const status = servedPage(await page.start(ctx));

		// The launcher reports asynchronously, the way Node does; the page is already serving.
		child.fail('Executable not found in $PATH: "xdg-open"');

		expect(notifications.at(-1)).toBe(
			`board: could not open the browser (Executable not found in $PATH: "xdg-open") — open ${status.url}`,
		);
		await page.stop();
	});

	test("honours serve.autoOpen: the page serves and no tab is asked for", async () => {
		const { page, ctx, opened } = harness({ serve: { autoOpen: false } });
		const status = servedPage(await page.start(ctx));
		expect(status.port).toBeGreaterThan(0);
		expect(opened).toEqual([]);
		await page.stop();
	});

	test("opens no tab on a remote turn, and says where the browser would be", async () => {
		const { page, ctx, opened, notifications } = harness();
		markRemote(ctx, quietChannel());

		const status = servedPage(await page.start(ctx));

		// The page is still served — a local session can attach to it — but a tab nobody is
		// looking at is not opened, and the person is told why.
		expect(opened).toEqual([]);
		expect(notifications.at(-1)).toBe(`board: the browser needs the local machine — open ${status.url}`);
		await page.stop();
	});
});
