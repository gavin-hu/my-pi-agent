/**
 * The page's snapshot: the one shape the browser is allowed to know, assembled from
 * what this session can read.
 *
 * `lib/board/view.ts` builds the shape; this module is the wiring that feeds it — the
 * cards, the bus's records when they are there, the store's size, and the clock. The
 * bus is read as data in its own directory, so the page lists teammates when the bus
 * has recorded them and draws exactly what it drew before when it has not.
 */

import { type Actor } from "../../lib/board/rules.ts";
import { gonePlans } from "../../lib/board/artifact.ts";
import type { BoardStore } from "../../lib/board/store.ts";
import { buildView, type BoardView } from "../../lib/board/view.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import { type WaitingPage, waitingMail } from "../../lib/session-mail.ts";

/** What a snapshot needs, all of it supplied by the page's lifecycle. */
export interface SnapshotContext {
	store: BoardStore;
	/** The actor every request is made and reported as: the page's seat. */
	actor: () => Actor;
	now: () => number;
	/** The bus's records for this repository, or `undefined` when it has never recorded one. */
	roster: () => Promise<RosterSession[] | undefined>;
	/**
	 * Where this repository's bus files its mail, or `undefined` when the caller cannot say.
	 *
	 * A path rather than a read, so the seam stays one call: a machine with no bus answers a
	 * directory that holds nothing, and the queue reads as empty either way.
	 */
	busDir: () => Promise<string>;
}

/** The snapshot the page renders, and the body of `/api/board`. */
export async function viewOf(context: SnapshotContext): Promise<BoardView> {
	const roster = await context.roster();
	// Read, never consumed: an inbox is its owner's, and a frame is drawn once a second. A bus
	// directory that cannot be read is a queue with nothing in it, said the same way as an empty
	// one — the page cannot act on the difference.
	const waiting: WaitingPage = await waitingMail(await context.busDir()).catch(() => ({ messages: [], dropped: 0 }));
	// One read of the pile answers every question a frame asks: the cards, the files it refused,
	// and the bytes they occupy. Asking `list` and `skipped` separately parsed every card twice,
	// once a second, for as long as a tab is open.
	const { cards, skipped, bytes } = await context.store.scan();
	return buildView({
		me: context.actor(),
		cards,
		now: context.now(),
		bytes,
		skipped,
		// A stat per card in a lane a plan gate is asked from, and none for the rest: the face can
		// only act on a card that still has a move left, and the reason line is where it says so.
		gonePlans: gonePlans(cards),
		repo: context.store.name(),
		root: context.store.root(),
		where: context.store.where(),
		limits: context.store.config().wip,
		// The lead is a configured role, not the seat that happens to serve: a board that renames
		// its lead must point the tab at the row its gates will answer.
		lead: context.store.config().lead,
		waiting,
		...(roster === undefined ? {} : { roster }),
	});
}
