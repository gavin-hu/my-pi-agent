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
import { sameLabel } from "../../lib/session-label.ts";

/** What a sweep needs of the session, so a suite drives it without a bus. */
export type SweepSession = Pick<BoardSession, "store" | "who" | "roster" | "now">;

/** `a and b`, never `a, and b`: a bullet in the first turn is one sentence, and two is the common case. */
function listed(items: readonly string[]): string {
	return items.length === 2 ? items.join(" and ") : listOf(items, "and");
}

/**
 * Hand a stopped session's cards on, and say which: the seat first, then the pool.
 *
 * Two verbs, because the caller is the fact that tells them apart. A card whose owner wears this
 * session's name is the one a `/resume` left behind — this session is the same work with a new id —
 * so it is re-seated: the owner id moves and the lane, plan and slot stay. Every other card an
 * owner stopped on is released into the pool, which is what the reclaim gate already lets a peer do.
 *
 * Refusals are skipped rather than reported: a refusal is a race (another session swept the same
 * card) or a record that changed between the read and the write, and the store's locked
 * read-check-write has already decided. Only a write that changed something is counted, so the
 * clause names exactly what this session wrote.
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
		const reseated: string[] = [];
		// True when any card in that list was a record the bus had pruned rather than one it watched stop:
		// the weaker fact, said in the clause a session acts on. Two seats of one name in one sweep is the
		// only way the qualifier can cover more than it should, and that is a case the bus does not make.
		let pruned = false;
		for (const card of cards) {
			if (card.owner === undefined || LANE_RULES[card.lane].terminal) continue;
			// A card this session holds is not its to release. A `/resume` that kept the id is already the
			// holder by it, and the record the crashed process left behind is gone by pid — so this sweep,
			// which runs right after the re-claim of those same paths, would take back what it just resumed.
			if (holds(card, me)) continue;
			const state = presenceOf(roster, card.owner, now);
			// The seat: this session wears the owner's label and the bus says that session stopped, so the
			// card is one a `/resume` left behind and is handed back rather than pooled. `absent` counts
			// here and nowhere else — a pruned record is the weaker fact, and the clause says which one.
			const seat = sameLabel(card.owner.label, me.label);
			const mine = seat && (state === "gone" || state === "absent");
			if (!mine && state !== "gone") continue;
			const holder = { owner: card.owner, state };
			const result = await store
				.mutate(card.id, mine ? { kind: "reseat", holder } : { kind: "reclaim", holder }, me, now)
				.catch(() => undefined);
			if (result?.ok !== true || !result.changed) continue;
			if (mine) {
				reseated.push(cardRef(card.id));
				if (state === "absent") pruned = true;
			} else released.push(cardRef(card.id));
		}
		if (released.length === 0 && reseated.length === 0) return undefined;
		// `a and b`, never `a, and b`: a bullet in the first turn is one sentence, and two cards is
		// the common case. The clause is the same shape `stray-fields` uses for the same reason.
		const parts: string[] = [];
		if (reseated.length > 0) {
			parts.push(`re-seated ${listed(reseated)} in this session${pruned ? " (owner record pruned)" : ""}`);
		}
		if (released.length > 0) {
			const from = released.length === 1 ? "a session that ended" : "sessions that ended";
			parts.push(`released ${listed(released)} from ${from}`);
		}
		return parts.join(", ");
	} catch {
		// A board that cannot be read is not a reason to fail the turn it was read for.
		return undefined;
	}
}
