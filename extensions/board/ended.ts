/**
 * The cards a session that ended left behind.
 *
 * A crashed worker's card otherwise holds a WIP slot until a person notices and reclaims it, and
 * the fact is already trustworthy: `#396` made `gone` pid-checked, and the reclaim gate reads it.
 * So the sweep at a turn start does what that gate already allows a peer to do, through the same
 * operation — the store decides, and a card whose owner turns out to be running is refused and left
 * where it is.
 *
 * One roster read for the whole board: the fact is one directory of records, so it is read once and
 * asked per owner rather than a directory read per card. `quiet` is deliberately not swept — a long
 * turn looks exactly like it — and that decision stays a person's, as `#396` left it.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cardRef, holds } from "../../lib/board/card.ts";
import { LANE_RULES } from "../../lib/board/lanes.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import { listOf } from "../../lib/format.ts";
import { presenceOf } from "../../lib/session-roster.ts";

/** What a sweep needs of the session, so a suite drives it without a bus. */
export type SweepSession = Pick<BoardSession, "store" | "who" | "roster" | "now">;

/**
 * Release every unfinished card whose owner's record says its session is gone, and say which.
 *
 * Refusals are skipped rather than reported: a refusal is a race (another session swept the same
 * card) or a record that changed between the read and the write, and the store's locked
 * read-check-write has already decided. Only a write that changed something is counted, so the
 * clause names exactly what this session released.
 */
export async function releaseEnded(session: SweepSession, ctx: ExtensionContext): Promise<string | undefined> {
	try {
		const me = await session.who(ctx, ctx.cwd);
		const store = await session.store(ctx.cwd);
		const roster = await session.roster(ctx.cwd);
		// No bus is the single-session board: nobody else owns a card, so there is nothing to sweep.
		if (roster === undefined) return undefined;
		const { cards } = await store.scan();
		const now = session.now();
		const released: string[] = [];
		for (const card of cards) {
			if (card.owner === undefined || LANE_RULES[card.lane].terminal) continue;
			// A card this session holds is not its to release. A `/resume` inherits the id, and the record
			// the crashed process left behind is gone by pid — so this sweep, which runs right after the
			// re-claim of those same paths, would take back the work it has just resumed.
			if (holds(card, me)) continue;
			const state = presenceOf(roster, card.owner, now);
			if (state !== "gone") continue;
			const result = await store
				.mutate(card.id, { kind: "reclaim", holder: { owner: card.owner, state } }, me, now)
				.catch(() => undefined);
			if (result?.ok === true && result.changed) released.push(cardRef(card.id));
		}
		if (released.length === 0) return undefined;
		// `a and b`, never `a, and b`: a bullet in the first turn is one sentence, and two cards is
		// the common case. The clause is the same shape `stray-fields` uses for the same reason.
		const what = released.length === 2 ? released.join(" and ") : listOf(released, "and");
		const from = released.length === 1 ? "a session that ended" : "sessions that ended";
		return `released ${what} from ${from}`;
	} catch {
		// A board that cannot be read is not a reason to fail the turn it was read for.
		return undefined;
	}
}
