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

import { join } from "node:path";
import { type BoardStore, CARDS_DIR_NAME } from "../../lib/workflow/store.ts";
import { readTeam } from "../../lib/session-roster.ts";
import { boardWire, buildView, type BoardWire } from "../../lib/workflow/view.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import type { WaitingMail } from "../../lib/session-mail.ts";
import { pageActor } from "../../lib/workflow/seat.ts";
import { type PagePointer, BOARD_BASE, readPointer } from "../../lib/workflow/page-pointer.ts";
import type { BoardSession } from "../../lib/workflow/session.ts";
import type { PageStart } from "../../extensions/board/page.ts";
import { testMountSource } from "./serve.ts";
import { type BoardServer, createBoardServer } from "../../extensions/board/transport/server.ts";
import { boardClientJs, type BoardPeriods } from "../../extensions/board/view/client.ts";
import { renderBoardPage } from "../../extensions/board/view/page.ts";

/** The page a start served here, or a failure that says why there is none. */
export function servedPage(start: PageStart): { port: number; url: string; seat: string } {
	if (start.kind !== "served") throw new Error(`the page was not served here: ${start.kind}`);
	return start;
}

/** The note a page leaves beside this board's cards. */
export async function noteOf(runtime: BoardSession, cwd: string): Promise<PagePointer | undefined> {
	return readPointer((await runtime.store(cwd)).dir);
}

/** What the page prints for the repository and the store it reads. */
export interface PageDisplay {
	/** The repository's name, as the tab and the header lead with it. */
	repo?: string;
	/** The repository root, absolute, as the header name's hover title carries it. */
	root?: string;
	/** The store's directory, shortened. */
	where?: string;
	/** The home a displayed path is shortened against; absent reads as this machine's home. */
	home?: string;
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
	/**
	 * This machine's host id, for a page that draws another machine's sessions as elsewhere.
	 *
	 * Omitted, the frame names no machine of its own, which reads every record that names a host as
	 * foreign — the honest answer for a fixture that never made an identity.
	 */
	host?: string;
	/**
	 * Mail waiting on the bus, read the way the page reads it: never consumed.
	 *
	 * The page draws this queue from files, so a caller that seeds one passes the rows the
	 * files would have produced rather than a directory a fixture would have to lay out. A
	 * fixture's queue fits one page, so the count its cap left out is zero.
	 */
	waiting?: () => WaitingMail[];
	/**
	 * A bus directory this page reads, for the cases about what the files add up to.
	 *
	 * Absent, the page draws the rows a caller hands it — the shape a case about drawing
	 * wants. A directory, and the frame is built by the shipping read (`readTeam`) over the mail
	 * on disk, which is the shape a case about counting wants:
	 * a stub cannot disagree with itself, so a stub cannot show a count being wrong.
	 */
	bus?: string;
	/**
	 * The page's two clocks, in ms.
	 *
	 * Omitted, the page is the one `/board` serves, on its own 1500 ms mark and 1000 ms tick. A
	 * suite that asserts a mark leaving or an age moving passes a shorter pair rather than waiting
	 * the product's period out for every assertion: the code path is the same one, smaller.
	 */
	periods?: BoardPeriods;
	/**
	 * The hint the page's stream sends its first reconnect, in ms.
	 *
	 * A case that reads what the page does once its stream is dead would otherwise wait out
	 * the product's two seconds twice to get there; this is the same seam as the idle grace's
	 * timer, one layer out.
	 */
	retryMs?: number;
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
	const { store, now, display = {}, roster, waiting, bus, host, retryMs, periods } = options;
	// What the page prints for its repository, resolved once so the document and every frame
	// name the same board: the toolbar is named before the first frame rather than after it.
	const repo = display.repo ?? store.name();
	const root = display.root ?? store.root();
	const view = async (): Promise<BoardWire> => {
		const at = now();
		const { cards, skipped, bytes } = await store.scan();
		// A bus directory goes through the shipping read, one pass for the roster and the queue the
		// way `/board` serves them; a suite that stubs either still draws exactly what it handed over.
		const team = bus === undefined ? undefined : await readTeam(bus);
		const sessions = team?.roster ?? (roster === undefined ? undefined : roster(at));
		const queue = team?.waiting ?? (waiting === undefined ? undefined : { messages: waiting(), dropped: 0 });
		// The same compaction `/board` serves: a suite that drove an uncompacted frame would be
		// testing bytes the browser never receives.
		return boardWire(
			buildView({
				// The page serves as its seat — the board's lead — and marks its own row: one name.
				me: pageActor(store.config().lead),
				cards,
				now: at,
				...(sessions === undefined ? {} : { roster: sessions }),
				...(team?.hosts === undefined ? {} : { hosts: team.hosts }),
				...(host === undefined ? {} : { host }),
				...(queue === undefined ? {} : { waiting: queue }),
				// The page is served as the seat, which the board's own config names: the lead flag
				// is the config's, and a fixture that renamed its lead must see the rename.
				lead: store.config().lead,
				bytes,
				skipped,
				repo,
				root,
				where: display.where ?? store.where(),
				...(display.home === undefined ? {} : { home: display.home }),
			}),
		);
	};
	// The page mounts on a real server, which is the socket `serve` would have given it.
	const started = await createBoardServer({
		mount: testMountSource(),
		session: "fixture",
		// The page the suite drives is the page `/board` serves, watch and all: a card the case
		// writes has to reach the tab the way a peer's write does.
		dirs: [join(store.dir, CARDS_DIR_NAME)],
		page: async (tab) =>
			renderBoardPage({ view: tab, base: BOARD_BASE, repo, root, where: display.where ?? store.where() }),
		script: boardClientJs(periods),
		...(retryMs === undefined ? {} : { retryMs }),
		view,
	});
	if (started.kind === "refused") throw new Error(started.reason);
	const server = started.server;
	return { url: server.url, server, close: () => server.close() };
}
