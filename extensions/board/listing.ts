/**
 * What a listing answers: the board, one card, the lead's rollup, and the archive.
 *
 * The `list` action's body in both of its shapes — the board itself, and the pile behind
 * `archived: true` — because the four answers are one read of the same record narrowed four ways.
 * The words are `format.ts`'s; what this module decides is which card, which lane, and which
 * refusal.
 *
 * Reached with `import()` from the call that lists, the way `archive.ts` is: none of it is needed
 * before a `list` arrives, so a session that never lists pays nothing for it and the board's entry
 * keeps the static graph `test/dependencies.test.ts` measures.
 */

import { planIsGone } from "../../lib/board/artifact.ts";
import { cardRef, holds, matchesQuery, normalizeCardId } from "../../lib/board/card.ts";
import { indexOf } from "../../lib/board/links.ts";
import { buildRound } from "../../lib/board/round.ts";
import { formatRound, withLiveOwner } from "../../lib/board/round-text.ts";
import type { BoardStore } from "../../lib/board/store.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import { textResult } from "../../lib/tool-result.ts";
import { formatArchive, formatBoard, formatCard } from "./format.ts";
import { refusal } from "./result.ts";
import type { BoardArgs } from "./schema.ts";
import type { BoardAction, BoardDetails } from "./types.ts";

/** The `list` fields that narrow a listing, in the order a refusal names them. */
const CARD_FILTERS = ["lane", "query", "mine", "round"] as const;

/**
 * The refusal for the filters a `list` that names a card would otherwise drop.
 *
 * `card` answers for that one card, so a filter beside it changes nothing — and a call that
 * sent both meant one of them. A dropped field is what `strayField` exists to prevent one
 * level up, so it is refused here in the same voice the archive's own reader uses.
 */
function cardFiltersRefusal(args: BoardArgs, fields: readonly (keyof BoardArgs)[] = CARD_FILTERS): string | undefined {
	const given = fields.filter((field) => args[field] !== undefined);
	return given.length === 0 ? undefined : `card does not read ${given.join(", ")}: it answers for that one card.`;
}

/** `list`: the board, one card, the lead's rollup, or the archive. */
export async function read(
	store: BoardStore,
	action: BoardAction,
	me: BoardDetails["me"],
	args: BoardArgs,
	now: number,
	roster: () => Promise<readonly RosterSession[] | undefined>,
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	// The roster is read for every listing, not only a rollup: a card shows its owner by the name the
	// session answers to now, and a rename moves the record rather than the card. No bus (`undefined`)
	// leaves the label the card kept. A decision that follows: `query` matches the live name, so the
	// dead one matches nothing — the rename is the board saying it no longer answers to it.
	const rosterRows = await roster().catch(() => undefined);
	if (args.archived === true) return readArchive(store, action, me, args, now, rosterRows);
	// One read of the pile answers both questions a listing asks — the cards, and the files the
	// reader refused, which is the difference between "not there" and "there, and unreadable".
	const scanned = await store.scan();
	const cards = scanned.cards.map((card) => withLiveOwner(card, rosterRows));
	const skipped = scanned.skipped;
	// A directory listing, not a read: a listing says what it left aside without opening one.
	const archived = await store.archivedCount();
	if (args.card !== undefined) {
		const ignored = cardFiltersRefusal(args);
		if (ignored !== undefined) return refusal(action, me, ignored);
		const id = normalizeCardId(args.card);
		if (id === undefined) return refusal(action, me, `"${args.card}" is not a card id.`);
		const card = cards.find((entry) => entry.id === id);
		if (!card) {
			// Gone and set aside are different answers, and one read by id tells them apart.
			if ((await store.read(id)) !== undefined) {
				return refusal(action, me, `${cardRef(id)} is archived; pass archived: true to read it.`);
			}
			const unreadable = skipped.find((entry) => entry.id === id);
			return refusal(
				action,
				me,
				unreadable === undefined
					? `${cardRef(id)} does not exist.`
					: `${cardRef(id)} is there and this build cannot read it (${unreadable.file}: ${unreadable.why}).`,
			);
		}
		// The one stat a read can afford, and the only card it can afford it on: a listing's rows carry
		// no plan line, so this is where a reader learns the file it would move on is already gone.
		return textResult(formatCard(card, indexOf(cards), now, planIsGone(card)), { action, me, card });
	}
	const listed = cards.filter(
		(card) =>
			(args.lane === undefined || card.lane === args.lane) &&
			(args.query === undefined || matchesQuery(card, args.query)) &&
			// The same rule a claim is checked against, so "mine" cannot list a card this
			// session could not release.
			(args.mine !== true || holds(card, me)),
	);
	// A finished card is history rather than work, and nothing prunes it — this
	// repository's own board is mostly finished cards — so a listing that names no lane
	// leaves them out and says how many. A named lane and `card` are unchanged; the rollup
	// counts the whole board, which is what makes it a rollup.
	const hiddenDone = args.lane === undefined ? listed.filter((card) => card.lane === "done").length : 0;
	const shown = hiddenDone === 0 ? listed : listed.filter((card) => card.lane !== "done");
	// The rollup is the whole board's answer, so it is printed *after* the listing rather than
	// instead of it: a filter beside `round` asked two questions, and a call that answered only
	// one of them dropped the other without saying so.
	const narrowed = args.lane !== undefined || args.query !== undefined || args.mine === true;
	const listing = formatBoard(shown, { hiddenDone, archived, skipped, narrowed });
	const details: BoardDetails = {
		action,
		me,
		cards: shown,
		...(narrowed ? { narrowed } : {}),
		...(args.mine === true ? { mine: true } : {}),
	};
	if (args.round !== true) return textResult(listing, details);
	const round = buildRound(cards, now);
	const text = `${listing}\n\n${formatRound(cards, round, rosterRows)}`;
	return textResult(text, { ...details, round });
}

/**
 * `list archived: true`: the cards set aside, which no board read opens.
 *
 * A lane and a rollup are answers about the board, so asking for the archive with either
 * is refused rather than quietly ignored: the pile is one thing, and every card in it is
 * finished. A query and `mine` narrow it, because both are questions about a card.
 */
async function readArchive(
	store: BoardStore,
	action: BoardAction,
	me: BoardDetails["me"],
	args: BoardArgs,
	now: number,
	roster: readonly RosterSession[] | undefined,
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	const wrong = (["lane", "round"] as const).filter((field) => args[field] !== undefined);
	if (wrong.length > 0) {
		return refusal(
			action,
			me,
			`archived does not read ${wrong.join(", ")}: the archive is one pile of finished cards, out of the board.`,
		);
	}
	const pile = await store.archived();
	// A finished card's owner can have renamed after the close too, and the pile is read by the same person.
	const cards = pile.cards.map((card) => withLiveOwner(card, roster));
	if (args.card !== undefined) {
		// `query` and `mine` narrow the pile, not the one card it would answer for.
		const ignored = cardFiltersRefusal(args, ["query", "mine"]);
		if (ignored !== undefined) return refusal(action, me, ignored);
		const id = normalizeCardId(args.card);
		if (id === undefined) return refusal(action, me, `"${args.card}" is not a card id.`);
		const card = cards.find((entry) => entry.id === id);
		if (!card) {
			const onBoard = (await store.list()).some((entry) => entry.id === id);
			return refusal(
				action,
				me,
				onBoard ? `${cardRef(id)} is on the board, not in the archive.` : `${cardRef(id)} is not in the archive.`,
			);
		}
		return textResult(formatCard(card, indexOf(cards), now), { action, me, card });
	}
	const shown = cards.filter(
		(card) => (args.query === undefined || matchesQuery(card, args.query)) && (args.mine !== true || holds(card, me)),
	);
	return textResult(formatArchive(shown, pile.skipped), {
		action,
		me,
		cards: shown,
		...(args.mine === true ? { mine: true } : {}),
	});
}
