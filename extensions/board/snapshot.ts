/**
 * The page's snapshot: the one shape the browser is allowed to know, assembled from
 * what this session can read.
 *
 * `lib/board/view.ts` builds the shape; this module is the wiring that feeds it — the
 * cards, the bus's records when they are there, the store's size, and the clock. The
 * bus is read as data in its own directory, so the page lists teammates when the bus
 * has recorded them and draws exactly what it drew before when it has not.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { type Actor } from "../../lib/board/rules.ts";
import { gonePlans } from "../../lib/board/artifact.ts";
import type { Card } from "../../lib/board/card.ts";
import { type BoardStore, CARDS_DIR_NAME, type Skip } from "../../lib/board/store.ts";
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

/** A pile already read: the cards, the files the reader refused, and the bytes they take. */
export type Pile = { cards: Card[]; skipped: Skip[]; bytes: number };

/** The snapshot the page renders, and the body of `/api/board`. */
export async function viewOf(context: SnapshotContext, pile?: Pile): Promise<BoardView> {
	const roster = await context.roster();
	// Read, never consumed: an inbox is its owner's, and a frame is drawn once a second. A bus
	// directory that cannot be read is a queue with nothing in it, said the same way as an empty
	// one — the page cannot act on the difference.
	const waiting: WaitingPage = await waitingMail(await context.busDir()).catch(() => ({ messages: [], dropped: 0 }));
	// One read of the pile answers every question a frame asks: the cards, the files it refused,
	// and the bytes they occupy. Asking `list` and `skipped` separately parsed every card twice,
	// once a second, for as long as a tab is open.
	const { cards, skipped, bytes } = pile ?? (await context.store.scan());
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

/** One page's frames, and the pile they share while nothing is written. */
export interface Snapshot {
	/**
	 * The page's frame. The pile is read again when `cards/` itself moved, and after a run of frames
	 * in which it did not — the bound {@link PILE_RESYNC_FRAMES} says why.
	 */
	view(): Promise<BoardView>;
}

/**
 * Frames a pile may serve, since the read that made it, before it is read again regardless.
 *
 * The stamp is the key, and on any filesystem Pi runs on a rename moves it. On one whose mtime
 * resolution is coarser than a write — a mounted FAT or NFS volume with a one-second tick — a card
 * can land on the stamp the last read already saw, and no later frame would ever ask again: the
 * five-second sweep reads this same cache. Frames rather than seconds, because the derived facts a
 * sweep draws (an age, a plan removed) are drawn from the pile on purpose, and a clock advance must
 * not turn into a re-read.
 */
export const PILE_RESYNC_FRAMES = 30;

/**
 * A page's snapshot, holding the pile between frames.
 *
 * The frame is asked for on every watch event, on the five-second sweep and — with no watch to
 * arm — every second, and each one used to read and parse every card file. Most of what a sweep
 * looks at does change without a card write (the roster, the mail queue, a plan removed, the
 * clock), but the pile does not: every card write lands as a temp file renamed inside `cards/`, so
 * that directory's mtime is the cheap question "has anything been written?". One `stat` instead of
 * a readdir and a parse per card, and the facts no file announces are still read every frame.
 *
 * A directory that cannot be stat'd is a miss rather than an error — a store opened on a directory
 * that has since moved still draws, by reading the pile as it always did. The key is not trusted
 * for ever: a pile that has served {@link PILE_RESYNC_FRAMES} frames is read again, so a filesystem
 * whose stamp cannot move behind a write cannot leave the page showing yesterday's board. Nothing is
 * evicted: the cache is one page's, and it dies with the page.
 */
export function createSnapshot(context: SnapshotContext): Snapshot {
	/** The last pile read, the stamp it was read under, and the frames it has served since. */
	let kept: (Pile & { stamp: number | undefined; frames: number }) | undefined;
	const stampOf = async (): Promise<number | undefined> =>
		stat(join(context.store.dir, CARDS_DIR_NAME))
			.then((info) => info.mtimeMs)
			.catch(() => undefined);
	return {
		async view() {
			const stamp = await stampOf();
			const reused =
				kept !== undefined && stamp !== undefined && kept.stamp === stamp && kept.frames < PILE_RESYNC_FRAMES;
			if (reused && kept !== undefined) kept.frames += 1;
			else kept = { stamp, frames: 0, ...(await context.store.scan()) };
			// The read pile is handed over rather than reached for through `kept`, so the frame cannot
			// see a stamp without its cards.
			return viewOf(context, kept);
		},
	};
}
