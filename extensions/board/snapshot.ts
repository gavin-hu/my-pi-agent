/**
 * The page's snapshot: the one shape the browser is allowed to know, assembled from
 * what this session can read.
 *
 * `lib/board/view.ts` builds the shape; this module is the wiring that feeds it — the
 * cards, the bus's records when they are there, the store's size, and the clock. The
 * bus is read as data in its own directory, so the page lists teammates when the bus
 * has recorded them and draws exactly what it drew before when it has not.
 */

import type { Actor } from "../../lib/board/rules.ts";
import type { BoardStore } from "../../lib/board/store.ts";
import { buildView, type BoardView } from "../../lib/board/view.ts";
import { readRoster } from "../../lib/session-roster.ts";

/** What a snapshot needs, all of it supplied by the page's lifecycle. */
export interface SnapshotContext {
	store: BoardStore;
	/** The actor every request is made and reported as: the page's seat. */
	actor: () => Actor;
	now: () => number;
	/** Where this repository's bus files its records. */
	busDir: () => Promise<string>;
}

/** The snapshot the page renders, and the body of `/api/board`. */
export async function viewOf(context: SnapshotContext): Promise<BoardView> {
	const roster = await readRoster(await context.busDir());
	// One read of the pile answers both: a frame that asked `list` and `skipped` separately
	// would parse every card twice, once a second, for as long as a tab is open.
	const { cards, skipped } = await context.store.scan();
	return buildView({
		me: context.actor(),
		cards,
		now: context.now(),
		bytes: await context.store.bytes(),
		skipped,
		repo: context.store.name(),
		root: context.store.root(),
		where: context.store.where(),
		limits: context.store.config().wip,
		...(roster === undefined ? {} : { roster }),
	});
}
