/**
 * The note a session holds on somebody else's page: what `/board status` and `/board stop`
 * read once the page behind it is gone.
 *
 * A page of its own, apart from `page.test.ts`'s seating and takeover, because this is the
 * half about the *viewer's* reference: the note in the repository may leave without it, and a
 * reference to a note that is not there is the one that has to be dropped. The server is the
 * shipped one, because attaching reads the note the serving page really wrote.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { boardHarness } from "../../test/helpers/board.ts";
import { noteOf, servedPage } from "../../test/helpers/board-page.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { testMountSource } from "../../test/helpers/serve.ts";
import type { ProbeFetch } from "../../lib/board/page-pointer.ts";
import { createBoardPage } from "./page.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 50_000;

/** The page one session runs over a temp board, as its own session id. */
function pageFor(board: ReturnType<typeof boardHarness>, probe?: ProbeFetch): ReturnType<typeof createBoardPage> {
	return createBoardPage(board.runtime, {
		// A real server with no session behind it: the socket `serve` would have handed over.
		mount: testMountSource(),
		session: () => "s1",
		open: () => {},
		...(probe === undefined ? {} : { probe }),
	});
}

describe("a note the serving session took with it", () => {
	test("is forgotten by its viewer, so status stops calling it stale", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		const serving = boardHarness({ cwd, agentDir, now: NOW, track: temps.track, sessionId: "s-lead" });
		const lead = pageFor(serving);
		const first = servedPage(await lead.start(serving.ctx));
		let answering = true;
		const viewing = boardHarness({ cwd, agentDir, now: NOW, track: temps.track, sessionId: "s-viewer" });
		const viewer = pageFor(viewing, async () => ({ ok: answering }));
		expect((await viewer.start(viewing.ctx)).kind).toBe("attached");

		// A clean exit takes the note with it, which is not the case a takeover exists for: the
		// viewer still holds a reference to a note that is not there, and its page is dead.
		await lead.stop();
		answering = false;
		expect(await noteOf(viewing.runtime, cwd)).toBeUndefined();
		expect(await viewer.status()).toMatchObject({
			running: false,
			attached: true,
			stale: true,
			port: first.port,
		});

		// There is nothing left to clear, so stop drops the reference: the answer says so rather
		// than calling the page it just proved dead "answering", and nothing calls it watching after.
		expect(await viewer.dropStale(viewing.ctx)).toBe("gone");
		expect(await viewer.status()).toEqual({ running: false });
	});
});
