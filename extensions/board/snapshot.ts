/**
 * The page's snapshot: the one shape the browser is allowed to know, assembled from
 * what this session can read.
 *
 * `lib/workflow/view.ts` builds the shape; this module is the wiring that feeds it — the
 * cards, the bus's records when they are there, the store's size, and the clock. The
 * bus is read as data in its own directory, so the page lists teammates when the bus
 * has recorded them and draws exactly what it drew before when it has not.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type Actor } from "../../lib/workflow/rules.ts";
import { gonePlans } from "../../lib/workflow/artifact.ts";
import type { Card } from "../../lib/workflow/card.ts";
import { type BoardStore, CARDS_DIR_NAME } from "../../lib/workflow/store.ts";
import type { Skip } from "../../lib/workflow/read.ts";
import { boardWire, buildView, type BoardWire } from "../../lib/workflow/view.ts";
import type { TeamRead } from "../../lib/session-roster.ts";

/** What a snapshot needs, all of it supplied by the page's lifecycle. */
export interface SnapshotContext {
	store: BoardStore;
	/** The actor every request is made and reported as: the page's seat. */
	actor: () => Actor;
	now: () => number;
	/**
	 * The bus as one pass read it: the teammates, and the queue that same read drew.
	 *
	 * One seam rather than a roster read and a mail read, because a page draws both and used to
	 * walk every inbox twice for them: the pass that names a teammate already read its files.
	 * A machine with no bus answers `roster: undefined` and an empty queue.
	 */
	bus: () => Promise<TeamRead>;
	/**
	 * This machine's host id, from `presence/host.json`, or nothing when it has none yet.
	 *
	 * The frame needs it to say which teammates are elsewhere: a record names its machine, and this
	 * is the one name that makes the rest foreign.
	 */
	host: () => Promise<string | undefined>;
	/**
	 * This host's plan store, for the cards whose recorded plan is asked about.
	 *
	 * A thunk because the store is resolved from the session — a git call the session memoizes per
	 * working directory — and a name a card records means nothing until it is joined to it.
	 */
	planDir: () => Promise<string>;
}

/** A pile already read: the cards, the files the reader refused, and the bytes they take. */
export type Pile = { cards: Card[]; skipped: Skip[]; bytes: number };

/** The snapshot the page renders, and the body of `/api/board`. */
export async function viewOf(context: SnapshotContext, pile?: Pile): Promise<BoardWire> {
	// Read, never consumed: an inbox is its owner's, and a frame is drawn once a second. A bus that
	// cannot be read is a page with no teammates and an empty queue, said the same way as one that
	// has never recorded anything — the page cannot act on the difference.
	const { roster, waiting, hosts } = await context.bus();
	const host = await context.host();
	// One read of the pile answers every question a frame asks: the cards, the files it refused,
	// and the bytes they occupy. Asking `list` and `skipped` separately parsed every card twice,
	// once a second, for as long as a tab is open.
	const { cards, skipped, bytes } = pile ?? (await context.store.scan());
	// The rollup names its cards instead of repeating them: the lanes inside the view are the
	// one copy a frame carries, and the browser expands the names against them.
	return boardWire(
		buildView({
			me: context.actor(),
			cards,
			now: context.now(),
			bytes,
			skipped,
			// A stat per card in a lane a plan gate is asked from, and none for the rest: the face can
			// only act on a card that still has a move left, and the reason line is where it says so. A
			// card keeps the plan's name, so the store is resolved to ask: the session memoizes it, and
			// a name joined to the wrong store would badge every named plan gone.
			gonePlans: gonePlans(await context.planDir(), cards),
			repo: context.store.name(),
			root: context.store.root(),
			where: context.store.where(),
			limits: context.store.config().wip,
			// The lead is a configured role, not the seat that happens to serve: a board that renames
			// its lead must point the tab at the row its gates will answer.
			lead: context.store.config().lead,
			waiting,
			...(roster === undefined ? {} : { roster }),
			...(hosts === undefined ? {} : { hosts }),
			...(host === undefined ? {} : { host }),
		}),
	);
}

/** One page's frames, and the pile they share while nothing is written. */
export interface Snapshot {
	/**
	 * The page's frame. The pile is read again when `cards/` itself moved, and after a run of frames
	 * in which it did not — the bound {@link PILE_RESYNC_FRAMES} says why.
	 */
	view(): Promise<BoardWire>;
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

/**
 * The bus's cheapest question: a stamp that moves when a file the page draws moves.
 *
 * It lives here rather than with the roster because it asks the page's question — *has anything
 * landed since the last frame* — and its one caller is the page's tick; the roster answers *who is
 * there*, which is the expensive half a stamp spares.
 *
 * A page asks this once a tick and reads the bus only when the answer changed, because that
 * read is a ledger walk over every record and every inbox. Contents are not what is asked: a
 * directory's **entry names** are, because that is what moves when a session joins or leaves
 * (`sessions/`), when an inbox appears (`inbox/`), and when a message lands or is consumed
 * (`inbox/<id>`). A directory's own mtime sits beside its names, and it is the half that is not
 * to be trusted: Windows updates it lazily, so an entry can land and leave the parent's clock
 * exactly where it was — a join that the poll then never saw. The mtime stays for the one change
 * a name set cannot see on POSIX, an entry renamed with the count unchanged. A path that is not
 * there reads `-`, so a bus arriving later is news rather than a silence.
 *
 * A record rewritten in place — a heartbeat, a label — moves neither, which is why the page
 * sweeps every five seconds for what no file announces.
 *
 * Never throws: a bus nobody can read is a stamp that does not move, and a caller's own slow
 * cadence still builds its frame.
 */
export async function stampBus(dir: string): Promise<string> {
	const { busPaths } = await import("../../lib/session-files.ts");
	const paths = busPaths(dir);
	const parts: string[] = [
		await stampOfDir(paths.dir),
		await stampOfDir(paths.sessions),
		await stampOfDir(paths.inbox),
		await stampOfDir(paths.hosts),
	];
	// Each inbox is its own directory, and its names are the messages a row counts.
	for (const name of await namesIn(paths.inbox)) {
		parts.push(`${name}:${await stampOfDir(join(paths.inbox, name))}`);
	}
	return parts.join("|");
}

/**
 * One directory as a stamp part: its mtime and its entry names, or `-` when it is not there.
 *
 * The names come from {@link namesIn}, which answers `[]` for a directory that vanished between
 * the stat and the listing — the race a page's one-second ticker would otherwise be the first to
 * meet.
 */
async function stampOfDir(path: string): Promise<string> {
	const mtime = await stampOf(path);
	return mtime === "-" ? mtime : `${mtime}|${(await namesIn(path)).join(",")}`;
}

/** One path's mtime as a stamp part: absent is `-`, because it is a value a later stamp can move. */
async function stampOf(path: string): Promise<string> {
	try {
		return String((await stat(path)).mtimeMs);
	} catch {
		return "-";
	}
}

/** One directory's entries, sorted: the order a listing comes back in is not a fact to compare. */
async function namesIn(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir)).sort();
	} catch {
		return [];
	}
}
