/**
 * The shipped board page, served over a fixture store the way `/board` serves it.
 *
 * Two callers drive this page from outside the extension: the browser suite, which proves
 * what a reader can do on it, and the screenshot script, which photographs it for the docs.
 * Both used to state the same two things separately — the server's four options and the
 * snapshot's fields — so a field added to `buildView` had two homes, and the picture could
 * show a page the suite never drove. This is that one statement: the store, the clock, and
 * what the page prints are the caller's; the wiring is not.
 *
 * A caller that seeds a bus passes `roster`, because the page draws the bus's records as
 * data and a fixture with no bus is a different page from one with an empty bus.
 */

import type { BoardStore } from "../../lib/board/store.ts";
import { buildView, type BoardView } from "../../lib/board/view.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import { pageActor } from "../../lib/board/seat.ts";
import { BOARD_BASE } from "../../lib/board/page-pointer.ts";
import { testMountSource } from "./serve.ts";
import { type BoardServer, createBoardServer } from "../../extensions/board/transport/server.ts";
import { BOARD_CLIENT_JS } from "../../extensions/board/view/client.ts";
import { renderBoardPage } from "../../extensions/board/view/page.ts";

/** What the page prints for the repository and the store it reads. */
export interface PageDisplay {
	/** The repository's name, as the tab and the header lead with it. */
	repo?: string;
	/** The repository root, absolute, as the header name's hover title carries it. */
	root?: string;
	/** The store's directory, shortened. */
	where?: string;
}

/** What a fixture page needs from its caller. */
export interface ServedBoardPageOptions {
	/** The store the page reads, seeded by the caller. */
	store: BoardStore;
	/**
	 * The clock every snapshot reads.
	 *
	 * A page prints ages, so this is what keeps a picture and an assertion off the wall
	 * clock: the suite hands in a fixed clock, and the shot hands in `Date.now` so the
	 * photograph is current.
	 */
	now: () => number;
	/**
	 * Overrides for a store that lives in a temp directory.
	 *
	 * Omitted, the page prints what the store answers — the honest output for a fixture
	 * that is not photographed.
	 */
	display?: PageDisplay;
	/** The bus's records to draw, or nothing at all for a page with no bus here. */
	roster?: (now: number) => RosterSession[];
}

/** One served page: the URL `/board` would open, the listener, and its close. */
export interface ServedBoardPage {
	/** The loopback URL, its token already on it, exactly what `/board` opens. */
	url: string;
	/** The listener behind it, for a caller that wants the port or a second close. */
	server: BoardServer;
	/** Close the listener; idempotent, like every other close in `lib/http`. */
	close(): Promise<void>;
}

/** Serve the shipped page over `store`, with a snapshot re-read for every frame. */
export async function serveBoardPage(options: ServedBoardPageOptions): Promise<ServedBoardPage> {
	const { store, now, display = {}, roster } = options;
	// What the page prints for its repository, resolved once so the document and every frame
	// name the same board: the toolbar is named before the first frame rather than after it.
	const repo = display.repo ?? store.name();
	const root = display.root ?? store.root();
	const view = async (): Promise<BoardView> => {
		const at = now();
		const { cards, skipped } = await store.scan();
		return buildView({
			// The page serves as its seat, and marks its own row: one actor, one name.
			me: pageActor(),
			cards,
			now: at,
			...(roster === undefined ? {} : { roster: roster(at) }),
			bytes: await store.bytes(),
			skipped,
			repo,
			root,
			where: display.where ?? store.where(),
		});
	};
	// The page mounts on a real server, which is the socket `serve` would have given it.
	const started = await createBoardServer({
		mount: testMountSource(),
		session: "fixture",
		page: async (tab) => renderBoardPage({ view: tab, base: BOARD_BASE, repo, root }),
		script: BOARD_CLIENT_JS,
		view,
	});
	if (started.kind === "refused") throw new Error(started.reason);
	const server = started.server;
	return { url: server.url, server, close: () => server.close() };
}
