/**
 * The card lifecycle: every transition, as a pure function of the card, the
 * operation, who asked, the clock, the board's other cards, and the board's limits.
 *
 * One table decides who may do what — the tool, the router, the page, and `team` all
 * route through {@link applyOp} — so a lane change cannot be reachable from one
 * surface and refused from another. Nothing here touches the filesystem or the bus:
 * ownership is advisory (the bus's path claims are the lock), and the store owns the
 * compare-and-set that makes a concurrent writer lose.
 *
 * Two shapes of failure, and the difference matters. A refusal is `{ ok: false }` with
 * the reason, and the caller returns the card untouched. A *no-op* is `{ ok: true,
 * changed: false }`: the operation's preconditions already hold (claiming a card you
 * already hold), so nothing is written and the revision does not move.
 *
 * {@link mayOp} is the same decision without writing it, which is what `team` asks
 * before it sends a handoff: a dry run is a question — "would this be allowed" — not a
 * mutation performed as a fake session.
 *
 * The board index is a parameter rather than a lookup because three operations need a
 * *different* card: a claim or a move is refused while a dependency is unfinished, and
 * a drop is refused while somebody waits on the card. `lib/board/links.ts` answers those
 * questions; this module decides what to do with the answer. The board's settings — its WIP
 * limits and the name its two signatures must carry — are one parameter for the same reason:
 * the rule decides, the reader of `bytefly.json` supplies them.
 *
 * `add` is {@link createCard} rather than an operation, because it has no card to
 * transition — and because a card is born in `backlog` with no owner, which is the one
 * state the other operations never produce.
 */

import type { ArtifactProof } from "./artifact.ts";
import { type Card, type CardBlock, CARD_VERSION, DEFAULT_PRIORITY, MAX_LOG, type Priority } from "./card.ts";
import type { CardType } from "./kind.ts";
import { type BoardConfig, DEFAULT_BOARD_CONFIG } from "./config.ts";
import type { Lane } from "./lanes.ts";
import type { BoardIndex } from "./links.ts";
import {
	approve,
	archive,
	closedArchive,
	assign,
	claim,
	contractOp,
	drop,
	edit,
	move,
	note,
	offer,
	release,
	review,
} from "./steps.ts";
import { type HolderFact, reclaim } from "./lead.ts";

/** Who is attempting an operation: a session when it has one, and the label it is addressed by. */
export interface Actor {
	id?: string;
	label: string;
}

/**
 * The pile the card was read from: the board, or the archive beside it.
 *
 * A state the record does not carry, because the pile *is* the state — `archive` renames a
 * finished card's file and writes nothing — so the caller that looked for the card is the one
 * that can say, and it hands the fact in the way it hands in the plan proof.
 */
export type Place = "board" | "archive";

/** One named mutation of one card. */
export type CardOp =
	/** Pull a backlog card into `plan`: the only way a card starts moving. */
	| { kind: "claim" }
	/**
	 * Hand a pool card to `to`: the owner is recorded and the card enters `plan`. A held card is
	 * refused — `reclaim` is how it changes hands — and `team assign` sends the handoff, which
	 * the state machine knows nothing about.
	 */
	| { kind: "assign"; to: Actor }
	| { kind: "release" }
	/**
	 * Change lane. `blockedBy` and `blocker` are what a block records, and `artifact` is the
	 * plan proof a card entering `execute` or `done` carries: each is read only by the lanes
	 * that ask for it. The proof is a question as often as an answer: a door hands over the way
	 * to find out, and the rule takes it where it asks — inside the store's locked pass.
	 */
	| {
			kind: "move";
			lane: Lane;
			blockedBy?: unknown;
			blocker?: unknown;
			artifact?: ArtifactProof;
	  }
	// `text` and the contract fields are whatever the model sent: the modules that own
	// them validate them, and the refusal they produce is the one the caller shows.
	| { kind: "note"; text: unknown }
	/**
	 * Write the contract and the plan it is executed against. `artifact` is what the caller
	 * proved: a resolved, existing plan file, or the sentence refusing it. The state machine
	 * decides — nothing here touches a filesystem — and a contract naming neither is refused,
	 * so a caller cannot skip the check by omitting it.
	 */
	| { kind: "contract"; artifact?: ArtifactProof; goal?: unknown; acceptance?: unknown; scopeOut?: unknown }
	/**
	 * Read the contract *and* the plan it names, and approve them: the lead, and never the card's
	 * holder; `text` is noted with the sign. `artifact` is what the caller proved about the plan, as
	 * `move` hands it in, so an approval cannot cover a plan file that is already gone.
	 */
	| { kind: "approve"; text?: unknown; artifact?: ArtifactProof }
	/** Spot-check the finished work: the lead, in `execute`, and never the card's holder; `text` is noted with the sign. */
	| { kind: "review"; text?: unknown; override?: unknown }
	// Every field but `kind` is optional, and an absent one is left as it was: the page
	// sends the three it can show, and omitting a link must not clear it.
	| {
			kind: "edit";
			title?: unknown;
			paths?: unknown;
			type?: unknown;
			breaking?: unknown;
			priority?: unknown;
			dependsOn?: unknown;
	  }
	/**
	 * Take a card back to `backlog`: the holder's own, the person's, the lead's, or — for anybody
	 * else — only when the bus says the owner has stopped. `holder` is what the caller found out
	 * about that session, bound to the owner it is about; absent is "cannot tell", and a caller
	 * that cannot tell only lets the lead take the card.
	 */
	| { kind: "reclaim"; holder?: HolderFact }
	/**
	 * Record that the card was offered to the team: `team offer` broadcasts it on the bus
	 * and then writes this, because an event nobody answers otherwise leaves no trace.
	 */
	| { kind: "offer" }
	/**
	 * Set a finished card aside: the store moves its file out of the board, and the record
	 * itself is unchanged, because the pile its file lies in is the whole of the state.
	 */
	| { kind: "archive" }
	| { kind: "drop" };

/**
 * What an operation did: the new card, or the reason it was refused.
 *
 * `signed` is the one fact `changed` cannot carry: a repeated sign that added a note writes the
 * card without stamping a signature, and the message a sign sends belongs to the stamp rather
 * than to the file.
 */
export type OpResult = { ok: true; card: Card; changed: boolean; signed?: true } | { ok: false; error: string };

/** What one operation would write, or why it may not. */
export type Prepared = { error: string } | { fields: Partial<Card> | null; changed: boolean; signed?: true };

/** A card's first state: `backlog`, no owner, one note at most. */
export function createCard(
	id: string,
	input: { title: string; paths: string[]; note?: string; priority?: Priority; type?: CardType; breaking?: boolean },
	actor: Actor,
	now: number,
): Card {
	return {
		v: CARD_VERSION,
		id,
		title: input.title,
		lane: "backlog",
		paths: [...input.paths],
		// A new card says its priority out loud, even when it is the ordinary one, so a
		// file on disk tells a reader the whole story without a default to know.
		priority: input.priority ?? DEFAULT_PRIORITY,
		// Its type is recorded only when somebody named one: absence draws nothing, so there
		// is no default to write and no word on the face that nobody chose.
		...(input.type === undefined ? {} : { type: input.type }),
		// Breaking is the one exception to "say the ordinary value out loud": `false` is the
		// overwhelming answer, and a key on every card would be noise in every file.
		...(input.breaking === true ? { breaking: true } : {}),
		notes: input.note === undefined ? [] : [{ by: actor.label, at: now, text: input.note }],
		notesDropped: 0,
		// A card is born in `backlog`, and that is a transition like any other: a reader
		// asking "how long has this been waiting" gets an answer rather than an absence.
		log: [{ lane: "backlog", at: now, by: actor.label }],
		logDropped: 0,
		rev: 1,
		createdAt: now,
		updatedAt: now,
		by: actor.label,
	};
}

/**
 * Why `actor` may not apply `op` to `card`, or `undefined` when it may.
 *
 * The answer a dry run asks for: it computes everything a write would check and nothing
 * a write would store, so `team` can find out whether a handoff is deliverable before it
 * sends one.
 */
export function mayOp(
	card: Card,
	op: CardOp,
	actor: Actor,
	board: BoardIndex,
	config: BoardConfig = DEFAULT_BOARD_CONFIG,
	place: Place = "board",
): string | undefined {
	const prepared = prepare(card, op, actor, 0, board, config, place);
	return "error" in prepared ? prepared.error : undefined;
}

/**
 * Apply one operation.
 *
 * A refused operation returns the reason and no card: the caller already holds the
 * card it read, and a "refused" copy of it would be a second version of the truth.
 */
export function applyOp(
	card: Card,
	op: CardOp,
	actor: Actor,
	now: number,
	board: BoardIndex,
	config: BoardConfig = DEFAULT_BOARD_CONFIG,
	place: Place = "board",
): OpResult {
	const prepared = prepare(card, op, actor, now, board, config, place);
	if ("error" in prepared) return { ok: false, error: prepared.error };
	if (!prepared.changed) return { ok: true, card, changed: false };
	const signed = prepared.signed === true ? { signed: true as const } : {};
	// `archive` changes the pile a card's file lies in and no field at all, which is why
	// its step has nothing to write and the store's move is the whole of the operation.
	if (prepared.fields === null) return { ok: true, card, changed: true, ...signed };
	return { ok: true, card: write(card, actor, now, prepared.fields), changed: true, ...signed };
}

/**
 * The one place an operation becomes a write: each `step*` decides, this applies.
 *
 * The closed record is asked about here rather than in a step, because it is a fact about
 * where the card is rather than about the card: every operation has to answer it, and a step
 * that forgot would be a write into the archive.
 */
function prepare(
	card: Card,
	op: CardOp,
	actor: Actor,
	now: number,
	board: BoardIndex,
	config: BoardConfig,
	place: Place,
): Prepared {
	// A card set aside is history, and the pile its file lies in is the whole of that state:
	// nothing on the board, in the round, or on the page reads what a write there would change.
	// `drop` is the one operation it still takes — a card archived by mistake has no other way
	// out, since nothing un-archives — and `archive` again is the no-op the caller reports.
	if (place === "archive" && op.kind !== "drop" && op.kind !== "archive") return { error: closedArchive(card) };
	switch (op.kind) {
		case "claim":
			return claim(card, actor, board, config.wip);
		case "assign":
			return assign(card, op.to, board, config.wip);
		case "release":
			return release(card, actor);
		case "move":
			return move(card, op, actor, board, config);
		case "note":
			return note(card, op.text, actor, now);
		case "contract":
			return contractOp(card, op, actor);
		case "approve":
			return approve(card, op, actor, now, board, config);
		case "review":
			return review(card, actor, now, config, op.text, op.override);
		case "edit":
			return edit(card, op, actor, board);
		case "reclaim":
			return reclaim(card, actor, config, op.holder);
		case "offer":
			return offer(card, now, board, config.wip);
		case "archive":
			return archive(card, board);
		case "drop":
			return drop(card, actor, board);
		default:
			// A caller from an older build, or a hand-written fixture, names an operation this
			// one does not know: that is a refusal, not a crash on `undefined`.
			return { error: "unknown board operation." };
	}
}

/**
 * A card's log after one more transition, with the oldest dropped and counted.
 *
 * The block travels with the entry that parked the card, because the card's own `blocked`
 * is deleted on the way out: without it the answer to "why did this sit for two days" dies
 * with the resume, and the notes are the only other place it could have been written.
 */
function appendTransition(
	card: Card,
	lane: Lane,
	actor: Actor,
	now: number,
	block: CardBlock | undefined,
): Pick<Card, "log" | "logDropped"> {
	const entry = block === undefined ? { lane, at: now, by: actor.label } : { lane, at: now, by: actor.label, block };
	const log = [...(card.log ?? []), entry];
	const overflow = Math.max(0, log.length - MAX_LOG);
	return {
		log: overflow === 0 ? log : log.slice(overflow),
		logDropped: (card.logDropped ?? 0) + overflow,
	};
}

/**
 * A card with `fields` applied and its write marks moved.
 *
 * This is the one place a lane change is observed, because it is the one place every
 * transition ends: a note, a contract, or an edit writes fields and leaves the lane alone,
 * while a claim, an assign, a release, a reclaim, and a move all name the new one. So
 * the log is appended from here rather than from each operation, and an operation added
 * later cannot forget it.
 */
function write(card: Card, actor: Actor, now: number, fields: Partial<Card>): Card {
	const lane = fields.lane;
	const transition =
		lane !== undefined && lane !== card.lane
			? appendTransition(card, lane, actor, now, lane === "blocked" ? fields.blocked : undefined)
			: undefined;
	const next: Card = { ...card, ...fields, ...transition, rev: card.rev + 1, updatedAt: now, by: actor.label };
	// `owner: undefined` must clear the field rather than store a key holding it, so a
	// released card reads back exactly like one that was never claimed. Only an
	// explicit `owner` in `fields` may delete it: every other write keeps the holder.
	if ("owner" in fields && fields.owner === undefined) delete next.owner;
	// The same for a block and a spot-check: a card that left `blocked` has no reason and no
	// kind, and one that left `execute` is not reviewed, so a key holding undefined would be
	// one more shape for a reader to know about. A cleared breaking marker is the same case:
	// the record reads an absent key as not breaking.
	for (const field of ["blocked", "offeredAt", "review", "breaking"] as const) {
		if (field in fields && fields[field] === undefined) delete next[field];
	}
	// `blocked` is a fact about the `blocked` lane and nothing else: a card back in the pool, or
	// one claimed out of it, is not parked on that decision any more. This is here rather than
	// in each operation because every lane change ends in this one write — so a release, a
	// reclaim, and a claim clean it without any of them having to remember, and the transition
	// log keeps what the park was.
	if (next.lane !== "blocked") delete next.blocked;
	return next;
}
