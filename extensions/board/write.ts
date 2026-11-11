/**
 * One card write, as the result that reports it.
 *
 * Every action that names a card ends here: the store applies the operation under its own lock,
 * and this is the one place the answer becomes text and details — the card, the next step, the
 * lane crossing's clause, and the sign's. `drop` keeps its own function because it is the one
 * action whose card is gone, so its text names the id rather than the lane.
 *
 * The crossing is passed in rather than imported: what a lane means to the bus is `claims.ts`'s
 * rule, and this module's job is only to report what that rule said.
 */

import { type Card, normalizeCardId } from "../../lib/board/card.ts";
import type { CardOp } from "../../lib/board/rules.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import type { BoardStore, MutateResult } from "../../lib/board/store.ts";
import { textResult } from "../../lib/tool-result.ts";
import { formatCard, formatDropped } from "./format.ts";
import { refusal } from "./result.ts";
import type { BoardArgs } from "./schema.ts";
import type { BoardAction, BoardDetails } from "./types.ts";

/**
 * The `reclaim` op, with the one fact its gate reads: what the bus says about the card's holder.
 *
 * The card is read here to learn whose record to ask about. The board's own read under the lock is
 * still the authority — `reclaim` keeps the fact only while it names the owner that read finds —
 * and a card that is not there, or a bus that cannot say, leaves the op with no fact at all: the
 * lead goes through and a peer is refused, which is the rule's answer when nothing is known.
 */
export async function reclaimOp(
	session: BoardSession,
	store: BoardStore,
	raw: string | undefined,
	cwd: string,
): Promise<CardOp> {
	const id = raw === undefined ? undefined : normalizeCardId(raw);
	const card = id === undefined ? undefined : await store.read(id).catch(() => undefined);
	const holder = card === undefined ? undefined : await session.holder(cwd, card);
	return { kind: "reclaim", ...(holder === undefined ? {} : { holder }) };
}

/**
 * Apply one op and report it: the card, the next step, the lane crossing's clause, and the sign's.
 *
 * The id the caller typed is normalized here, and a refusal carries the card the store left alone
 * so the next call starts from the truth. The crossing runs after the write for the same reason
 * the sign's message does: a bus that cannot answer must never cost the write it came after.
 */
export async function mutate(
	store: BoardStore,
	action: BoardAction,
	me: BoardDetails["me"],
	now: number,
	args: BoardArgs,
	op: CardOp,
	/**
	 * What the call says besides the card: `next` after any successful write, `told` when the result
	 * says a sign owes the owner its message, `cross` for the four actions whose write can cross
	 * a lane, and `joined` for the one action whose write makes this session a teammate. `told` is
	 * not gated on the write: a repeat sign that stamped nothing still owes one while the card says
	 * the sign was never told.
	 */
	report: {
		next?: string;
		told?: (card: Card) => Promise<{ card?: Card; line?: string } | undefined>;
		cross?: (result: MutateResult) => Promise<string | undefined>;
		joined?: () => Promise<string | undefined>;
	} = {},
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	if (args.card === undefined) return refusal(action, me, 'card is required: pass the id, e.g. "4".');
	const id = normalizeCardId(args.card);
	if (id === undefined) return refusal(action, me, `"${args.card}" is not a card id.`);
	const result = await store.mutate(id, op, me, now);
	if (!result.ok) return refusal(action, me, result.error, result.card);
	const told = result.announce === true ? await report.told?.(result.card) : undefined;
	// A sign the owner was just told of is a card that moved: the announced write is the newer read.
	const card = told?.card ?? result.card;
	// After the write, as the sign's message is: a bus that cannot answer costs a clause and
	// never the move it came after.
	const held = report.cross === undefined ? undefined : await report.cross(result).catch(() => undefined);
	// The same rule for the team: the card is taken either way, so a join that did not land is a
	// line on the result rather than an error that reads as nothing having happened.
	const joined = report.joined === undefined ? undefined : await report.joined().catch(() => undefined);
	const body = [
		formatCard(card),
		report.next,
		// The clause carries the continuation indent its neighbours do, the one `announce` writes
		// into its own sentence: a flush-left line under an indented card reads as a second card.
		held === undefined ? undefined : `  ${held}`,
		told?.line,
		joined === undefined ? undefined : `  ${joined}`,
	].filter((line): line is string => line !== undefined);
	return textResult(body.join("\n"), {
		action,
		me,
		card,
		...(told?.line === undefined ? {} : { told: told.line.trim() }),
		...(held === undefined ? {} : { held: held.trim() }),
	});
}

/** `drop`: the card and its notes leave together, so the report is the id. */
export async function dropCard(
	store: BoardStore,
	me: BoardDetails["me"],
	args: BoardArgs,
	now: number,
	cross: (result: MutateResult) => Promise<string | undefined>,
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	if (args.card === undefined) return refusal("drop", me, 'card is required: pass the id, e.g. "4".');
	const id = normalizeCardId(args.card);
	if (id === undefined) return refusal("drop", me, `"${args.card}" is not a card id.`);
	const result = await store.mutate(id, { kind: "drop" }, me, now);
	if (!result.ok) return refusal("drop", me, result.error, result.card);
	// A dropped card can carry the paths of work still in flight, and a claim nobody releases
	// would keep a peer off files that are no longer anybody's.
	const held = await cross(result).catch(() => undefined);
	return textResult([formatDropped(id), ...(held === undefined ? [] : [`  ${held}`])].join("\n"), {
		action: "drop",
		me,
		dropped: id,
		...(held === undefined ? {} : { held: held.trim() }),
	});
}
