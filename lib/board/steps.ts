/**
 * What each operation does: the gates, the lane changes, and the sentence a refusal carries.
 *
 * Split from `rules.ts`, which owns the operation table, the dispatch, and the one write.
 * This module answers "may this happen, and what would it change" and never touches the
 * store: keeping the two apart is what lets the dispatch read as one switch and the rules
 * read as one decision per operation. `lead.ts` owns the one operation beside this module,
 * because its gate reads a fact from outside the card.
 *
 * Two shapes of answer, and the difference matters. `{ error }` is a refusal, and the card
 * is returned untouched. `{ changed: false }` is a no-op: the operation's preconditions
 * already hold (claiming a card you already hold), so nothing is written and the revision
 * does not move. `{ fields: null, changed: true }` is an operation that changes the board
 * without changing the record — `archive` moves the file, and that is the store's write.
 */

import { listOf } from "../format.ts";
import {
	BLOCKERS,
	type Card,
	type CardOwner,
	cardRef,
	dependsOf,
	holds,
	MAX_NOTES,
	normalizeBlock,
	normalizeNote,
	normalizePathHints,
	normalizePlanPath,
	normalizePriority,
	normalizeTitle,
	priorityOf,
} from "./card.ts";
import { breakingOf, normalizeBreaking, normalizeType } from "./kind.ts";
import { type ArtifactProof, contractRoute, proved } from "./artifact.ts";
import {
	CONTRACT_FIELDS,
	mergedContract,
	missingContractFields,
	normalizeContractField,
	normalizeInstruction,
} from "./contract.ts";
import { type BoardConfig } from "./config.ts";
import {
	currentReview,
	holderRefusal,
	missingSign,
	owesAnnouncement,
	signMark,
	signRefusal,
	signedAs,
} from "./lead.ts";
import { type WipLimits, wipRefusal } from "./limits.ts";
import { LANE_RULES, type Lane, type Requirement, targetsFrom, transitionOf } from "./lanes.ts";
import { type BoardIndex, dependedOn, lanesText, normalizeDepends, openDependentsOf, waitingOn } from "./links.ts";
import type { Actor, CardOp, Prepared } from "./rules.ts";

/** Pull a backlog card into `plan`: the one door into the work. */
export function claim(card: Card, actor: Actor, board: BoardIndex, limits: WipLimits): Prepared {
	if (LANE_RULES[card.lane].terminal) return { error: `${cardRef(card.id)} is done; it cannot be claimed.` };
	if (holds(card, actor)) return { changed: false, fields: null };
	if (card.owner !== undefined) return { error: heldBy(card) };
	// The wait is asked here rather than read off the table: a claim enters `plan` from the pool,
	// which is not a lane change `move` can make, so `backlog → plan`'s requirements would be
	// read by nobody.
	const waiting = waitingOn(card, board);
	if (waiting !== undefined) return { error: waiting };
	return enter(card, "plan", board, limits, { owner: ownerOf(actor), offeredAt: undefined });
}

/**
 * Hand a pool card to somebody: the owner is recorded and the card enters `plan`.
 *
 * A held card is refused rather than handed over, because the owner a handoff would skip is
 * the one the rules protect: changing hands is `reclaim` and a second assignment. Naming the
 * session that already holds it is refused too, and for the message rather than the write:
 * the write would be a no-op, but `team` sends before it writes, so accepting the no-op spent
 * a second handoff on a card nobody was handed.
 */
export function assign(card: Card, to: CardOwner, board: BoardIndex, limits: WipLimits): Prepared {
	if (LANE_RULES[card.lane].terminal) return { error: `${cardRef(card.id)} is done; it cannot be assigned.` };
	if (card.owner !== undefined) return { error: holds(card, to) ? alreadyHeldBy(card) : heldBy(card) };
	const waiting = waitingOn(card, board);
	if (waiting !== undefined) return { error: waiting };
	// A pool card is the only card this moves, so it comes with the lane a claim would give it:
	// the owner inherits the work from its first step.
	return enter(card, "plan", board, limits, { owner: to, offeredAt: undefined });
}

/** Hand a card back to the pool. The contract and its approval stay: the plan did not change. */
export function release(card: Card, actor: Actor): Prepared {
	// Finished work is history: every other transition refuses it, and a release that did
	// not would be the one way a `done` card could go backwards — reopening the order a
	// dependency was recorded against.
	if (LANE_RULES[card.lane].terminal) return { error: `${cardRef(card.id)} is done; it cannot be released.` };
	if (card.owner === undefined) return { error: `${cardRef(card.id)} is not claimed.` };
	if (!holds(card, actor)) return { error: `${heldBy(card)} Release is the owner's decision.` };
	return { changed: true, fields: releasedToPool() };
}

/** Release's answer: nobody's, and the spot-check does not travel with it. */
function releasedToPool(): Partial<Card> {
	return {
		lane: "backlog",
		owner: undefined,
		offeredAt: undefined,
		// A review is a statement about work finished in `execute`; a card its own holder hands
		// back is not finished, so the sign cannot travel with it. A `reclaim` keeps it instead:
		// the sign is evidence, and only its signer withdraws it (`lead.ts`).
		review: undefined,
	};
}

export function move(
	card: Card,
	op: Extract<CardOp, { kind: "move" }>,
	actor: Actor,
	board: BoardIndex,
	config: BoardConfig,
): Prepared {
	const target = op.lane;
	if (LANE_RULES[card.lane].terminal) return { error: `${cardRef(card.id)} is done; it cannot be moved.` };
	if (card.owner === undefined) {
		return { error: `${cardRef(card.id)} is unclaimed; claim it before moving it to ${target}.` };
	}
	if (!holds(card, actor)) return { error: `${heldBy(card)} Only its owner can move it.` };
	if (target === "backlog") {
		return { error: `${cardRef(card.id)} cannot be moved to backlog; release it instead.` };
	}
	// A block's kind and sentence belong to a move into `blocked`, so a caller that sent them
	// with any other target hears that instead of a success that recorded nothing.
	if (target !== "blocked" && (op.blocker !== undefined || op.blockedBy !== undefined)) {
		return { error: `a blocker is recorded by a move to blocked, not to ${target}.` };
	}
	// A block's reason and kind are checked before the no-op: a caller that repeats a move
	// with a new sentence meant to change it, and a refusal is clearer than a silent nothing.
	const block = target === "blocked" ? blockFields(op.blocker, op.blockedBy) : undefined;
	if (block !== undefined && "error" in block) return { error: block.error };
	// A reason is what the card was parked on, so it is fixed for as long as the card is: changing
	// it means leaving the lane, and a caller asking to is told which way.
	if (card.lane === "blocked" && target === "blocked") {
		return {
			error: `${cardRef(card.id)} is blocked; its reason is fixed while the card is parked — resume it, then park it again with the new sentence.`,
		};
	}
	if (card.lane === target) return { changed: false, fields: null };
	const transition = transitionOf(card.lane, target);
	if (transition === undefined) return { error: noRoute(card, target) };
	for (const need of transition.needs) {
		const refusal = unmet(need, card, board, op.artifact, config);
		if (refusal !== undefined) return { error: refusal };
	}
	const fields: Partial<Card> = { lane: target };
	if (block !== undefined && "fields" in block) Object.assign(fields, block.fields);
	// A spot-check signs the work as it stood, and `done` is the one lane that sign is evidence
	// for. Parking a card is somebody deciding it is not finished, and re-planning changes the
	// agreement, so those two exits drop it — and `review` refuses a finished card, so a move
	// that dropped the sign here could never be signed again.
	if (card.lane === "execute" && (target === "blocked" || target === "plan")) fields.review = undefined;
	if (target === "execute" || target === "plan") return enter(card, target, board, config.wip, fields);
	return { changed: true, fields };
}

/**
 * Enter a pulled lane, if it has room.
 *
 * One place for the two lanes a card is pulled into, so the limit is asked once and the
 * refusal names the card and the count: `claim`, `assign`, and `move` all come through here.
 */
function enter(
	card: Card,
	lane: "plan" | "execute",
	board: BoardIndex,
	limits: WipLimits,
	fields: Partial<Card>,
): { error: string } | { fields: Partial<Card>; changed: true } {
	const full = wipRefusal(lane, [...board.values()], limits, card.lane);
	if (full !== undefined) return { error: `${cardRef(card.id)} cannot enter ${lane}: ${full}` };
	return { changed: true, fields: { ...fields, lane } };
}

/** What a lane change to `blocked` records: one block, holding the kind and the sentence. */
function blockFields(rawBlocker: unknown, rawSentence: unknown): { error: string } | { fields: Partial<Card> } {
	if (rawBlocker === undefined) {
		return { error: `a block needs a blocker: ${BLOCKERS.join(", ")}.` };
	}
	const block = normalizeBlock(rawBlocker, rawSentence);
	if ("error" in block) return { error: block.error };
	return { fields: { blocked: block.blocked } };
}

/** Why a transition's requirement is not met, or `undefined` when it is. */
function unmet(
	need: Requirement,
	card: Card,
	board: BoardIndex,
	artifact: ArtifactProof | undefined,
	config: BoardConfig,
): string | undefined {
	switch (need) {
		case "waiting":
			return waitingOn(card, board);
		case "contract": {
			const missing = missingContractFields(card.contract);
			if (missing.length === 0) return undefined;
			return `${cardRef(card.id)} is in ${card.lane}; its contract needs ${listOf(CONTRACT_FIELDS, "and")} — missing: ${missing.join(", ")}.`;
		}
		case "approval":
			return card.contract?.approved === undefined ? missingSign(card, config.lead, "approve") : undefined;
		case "review":
			// The sign that speaks for this execution, not the one a reclaim carried back into the pool:
			// a card taken back and executed again owes the lead a fresh look (`currentReview`).
			return currentReview(card) === undefined ? missingSign(card, config.lead, "review") : undefined;
		case "artifact": {
			if (card.planPath === undefined) return noArtifact(card);
			// Fail closed: a lane that requires a proved plan refuses when the caller did not
			// hand one in, so a surface added later cannot pass the gate by forgetting it. A
			// check that failed speaks with its own sentence, built where the file was read.
			if (artifact === undefined) return unprovedPlan(card);
			// The caller hands over the question, not the answer: `applyOp` runs inside the store's lock,
			// so this is the stat taken there — a file deleted while the write waited is refused here.
			const check = proved(artifact);
			if ("error" in check) return check.error;
			// The proof is bound to the record it was computed for: a fact about one path cannot
			// open a card whose path is another, and a plan re-recorded between the read and the
			// write is a card to read again rather than one to force. A fact that names no
			// record is bound by its own path, which is what a caller holding one file means.
			return (check.recorded ?? check.path) === card.planPath ? undefined : stalePlan(card);
		}
		case "blocker":
			// Asked and answered by `blockFields`, which needs the op this gate cannot see: the
			// requirement is named in the table so a reader sees the whole of what `blocked` wants.
			return undefined;
	}
}

/** The refusal for a lane a card may not move to from where it is. */
function noRoute(card: Card, target: Lane): string {
	const targets = targetsFrom(card.lane);
	const where = card.lane === "done" ? "it is finished" : `it can move to ${listOf(targets)}`;
	return `${cardRef(card.id)} is in ${card.lane}; ${where}, not ${target}.`;
}

function noArtifact(card: Card): string {
	return `${cardRef(card.id)} has no plan recorded; ${contractRoute(card)}`;
}

/** The refusal for a caller that recorded a plan but did not prove it. */
function unprovedPlan(card: Card): string {
	return `${cardRef(card.id)}'s plan was not checked; ${contractRoute(card)}`;
}

/** The refusal for a proof that belongs to a different recorded path. */
function stalePlan(card: Card): string {
	return `${cardRef(card.id)}'s plan changed while it was being read; ${contractRoute(card)}`;
}

/**
 * Add a note to the card's history: the holder's, or anyone's while nobody holds it.
 *
 * A note is content, not a sign, so it follows `edit` and not `approve` — and freeing the gate
 * is also what keeps the rollup's unwritten clock honest: `updatedAt` moves on every write,
 * so a note from a session that does not hold the card would hide an unwritten card from
 * the lead.
 */
export function note(card: Card, raw: unknown, actor: Actor, now: number): Prepared {
	if (card.owner !== undefined && !holds(card, actor)) {
		return { error: `${heldBy(card)} Only its owner can add a note.` };
	}
	const parsed = normalizeNote(raw);
	if ("error" in parsed) return { error: parsed.error };
	return { changed: true, fields: appendNote(card, actor, now, parsed.text) };
}

/** A card's notes after one more, with the oldest dropped and counted. */
function appendNote(card: Card, actor: Actor, now: number, text: string): Pick<Card, "notes" | "notesDropped"> {
	const notes = [...card.notes, { by: actor.label, at: now, text }];
	const overflow = Math.max(0, notes.length - MAX_NOTES);
	return {
		notes: overflow === 0 ? notes : notes.slice(overflow),
		notesDropped: card.notesDropped + overflow,
	};
}

/**
 * Write the contract, and the plan file it is executed against.
 *
 * The plan lane's one act: a card is planned by saying what it promises, and the wording and
 * which file it names are what the approval covers — never the file's bytes, which the board
 * does not read — so a changed line or a different plan drops the signature. The plan is required —
 * a contract is a promise plus the agreement it will be read against, and a card whose
 * contract names no artifact has nothing to execute. A contract call that names nothing at
 * all is refused rather than quietly changing nothing.
 */
export function contractOp(card: Card, op: Extract<CardOp, { kind: "contract" }>, actor: Actor): Prepared {
	if (LANE_RULES[card.lane].terminal) return { error: `${cardRef(card.id)} is done; its plan cannot change.` };
	if (card.lane !== "plan") {
		return { error: `${cardRef(card.id)} is in ${card.lane}; its contract is written in plan.` };
	}
	if (!holds(card, actor)) return { error: `${heldBy(card)} Only its owner records a plan.` };
	if (op.artifact === undefined) {
		return {
			error: `contract needs the plan file ${cardRef(card.id)} is executed against: pass \`path\` as \`plan\` action \`write\` returned it.`,
		};
	}
	// Taken where it is asked, as the gate does: a contract lands inside the locked pass.
	const artifact = proved(op.artifact);
	if ("error" in artifact) return { error: artifact.error };
	const fields: Partial<Card> = {};
	const parsedPlan = normalizePlanPath(artifact.path);
	if ("error" in parsedPlan) return { error: parsedPlan.error };
	const rePointed = parsedPlan.path !== card.planPath;
	if (rePointed) fields.planPath = parsedPlan.path;
	const changed: Partial<Record<(typeof CONTRACT_FIELDS)[number], string>> = {};
	for (const field of CONTRACT_FIELDS) {
		const raw = op[field];
		if (raw === undefined) continue;
		const parsed = normalizeContractField(field, raw);
		if ("error" in parsed) return { error: parsed.error };
		if (parsed.text !== card.contract?.[field]) changed[field] = parsed.text;
	}
	if (Object.keys(changed).length > 0) fields.contract = mergedContract(card.contract, changed);
	// The sign names a promise *and* the file it will be read against, so pointing the card at
	// a different plan is a change to what was approved even when the three lines are the same:
	// keeping it would let a session swap the artifact after a peer read the old one.
	else if (rePointed && card.contract?.approved !== undefined) fields.contract = mergedContract(card.contract, {});
	if (Object.keys(fields).length === 0) return { changed: false, fields: null };
	return { changed: true, fields };
}

/**
 * Approve the contract: the lead, who does not hold the card, says the wording is right.
 *
 * Two refusals, and the order between them is the point: a holder that is also the lead is told
 * to release the card first, because a session signing its own wording is the gate approving
 * itself, and a session that is neither the lead nor the person is told whose signature the gate
 * takes. The person's `/board approve` is the other way in.
 *
 * `text` is the note the signer leaves with the sign, in the same write: a signer is exactly
 * the caller `note` refuses on a held card, so this is where a caveat has somewhere to go.
 */
export function approve(
	card: Card,
	op: Extract<CardOp, { kind: "approve" }>,
	actor: Actor,
	now: number,
	board: BoardIndex,
	config: BoardConfig,
): Prepared {
	if (LANE_RULES[card.lane].terminal) return { error: `${cardRef(card.id)} is done; its contract is closed.` };
	if (card.lane !== "plan") return { error: `${cardRef(card.id)} is in ${card.lane}; a contract is approved in plan.` };
	if (holds(card, actor)) return { error: `${heldBy(card)} ${holderRefusal(actor, config.lead, "approve")}` };
	const wrongSigner = signRefusal(card, actor, config.lead, "approve");
	if (wrongSigner !== undefined) return { error: wrongSigner };
	const contract = card.contract;
	const missing = missingContractFields(contract);
	// One refusal for both shapes: a card with no contract names every field, and one with a
	// line still blank names the blank one. A complete contract is never undefined, so the
	// check above is also what narrows it. The wording is asked about before the plan, because
	// a card without one has no plan to have lost — `contract` records the two together.
	if (contract === undefined || missing.length > 0) {
		const gaps = missing.length === 0 ? "" : `: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing`;
		return { error: `${cardRef(card.id)} has no contract to approve yet${gaps}.` };
	}
	// The sign covers the file as well as the promise, so the plan is proved here too: the move
	// asks the same question later with the same sentence, and an approval that covered a plan
	// already gone would be a signature on nothing. Order matches `move`'s requirement list.
	const unproved = unmet("artifact", card, board, op.artifact, config);
	if (unproved !== undefined) return { error: unproved };
	const noted = signNote(card, op.text, actor, now);
	if ("error" in noted) return { error: noted.error };
	// A second sign from the same signer says nothing new, so the contract keeps its stamp; the
	// note still lands, because a caller who wrote one recorded a fact about the card. Who the
	// signer is takes the name *and* the person's mark (`lead.ts`), not the label: the person signs
	// as the lead, so a label compare would read a lead's sign back as the person's and re-stamp it.
	const signed = signedAs(contract.approved, actor, config.lead);
	// A repeat owes the message only while the sign says it never landed (`lead.ts`): the one retry.
	const owes = owesAnnouncement(card, "approve", actor, config.lead);
	if (signed && !noted.wrote) return { changed: false, fields: null, ...(owes ? { announce: true as const } : {}) };
	const approval = signed ? {} : { contract: { ...contract, approved: { ...signMark(actor, config.lead), at: now } } };
	return { changed: true, fields: { ...approval, ...noted.fields }, ...(owes ? { announce: true as const } : {}) };
}

/**
 * Record the spot-check of finished work: the lead's, and never the holder's.
 *
 * `text` rides the sign here too, so "checked, and this is still wrong" is one call.
 *
 * `override` is the other way a finished card gets a sign, and it is somebody saying the gate
 * was jumped: the reason is required, the card must already be `done`, and no review may be on
 * it, because the one rule this relaxes is the lane and a reason is not a second signature. Who
 * may sign, and never the holder, is the same gate. The sign records how it was made, so a
 * forced close reads as one instead of as a clean one.
 */
export function review(
	card: Card,
	actor: Actor,
	now: number,
	config: BoardConfig,
	text?: unknown,
	override?: unknown,
): Prepared {
	const instruction = override === undefined ? undefined : normalizeInstruction(override);
	if (instruction !== undefined && "error" in instruction) return { error: instruction.error };
	if (instruction === undefined) {
		if (LANE_RULES[card.lane].terminal) return { error: `${cardRef(card.id)} is done; it cannot be reviewed.` };
		if (card.lane !== "execute") {
			return { error: `${cardRef(card.id)} is in ${card.lane}; finished work is spot-checked in execute.` };
		}
	} else if (!LANE_RULES[card.lane].terminal) {
		return { error: `${cardRef(card.id)} is in ${card.lane}; an override signs a card that is already done.` };
	}
	if (holds(card, actor)) return { error: `${heldBy(card)} ${holderRefusal(actor, config.lead, "review")}` };
	const wrongSigner = signRefusal(card, actor, config.lead, "review");
	if (wrongSigner !== undefined) return { error: wrongSigner };
	const signed = signedAs(currentReview(card), actor, config.lead);
	// The same rule as `approve`: the stamp owes the message, and a repeat owes it while untold.
	const owes = owesAnnouncement(card, "review", actor, config.lead);
	// A sign is a fact about a person and a moment, so an override never replaces one: it is how a
	// card with no spot-check gets a record, not how a record gets a different author. The same
	// signer, saying the same thing, is its own case — the sign is already the one it asked for.
	const already = currentReview(card);
	if (instruction !== undefined && already !== undefined && !(signed && already.byInstruction !== undefined)) {
		return {
			error: `${cardRef(card.id)} is already spot-checked by ${already.by}; an override signs a card that has no sign.`,
		};
	}
	const noted = signNote(card, text, actor, now);
	if ("error" in noted) return { error: noted.error };
	if (signed && !noted.wrote) return { changed: false, fields: null, ...(owes ? { announce: true as const } : {}) };
	const stamp =
		instruction === undefined
			? { ...signMark(actor, config.lead), at: now }
			: { ...signMark(actor, config.lead), at: now, byInstruction: instruction.text };
	const spotCheck = signed ? {} : { review: stamp };
	// As with `approve`: a second signer's note moves the card, and the owner's message follows the
	// stamp — or the untold sign a repeat still owes them.
	return { changed: true, fields: { ...spotCheck, ...noted.fields }, ...(owes ? { announce: true as const } : {}) };
}

/**
 * The note a signer leaves with the sign, in the same write.
 *
 * Validated after the gate, as `note` validates after the holder check: a card that cannot be
 * signed at all is the answer worth reading first.
 */
function signNote(
	card: Card,
	raw: unknown,
	actor: Actor,
	now: number,
): { fields: Partial<Card>; wrote: boolean } | { error: string } {
	if (raw === undefined) return { fields: {}, wrote: false };
	const parsed = normalizeNote(raw);
	if ("error" in parsed) return { error: parsed.error };
	return { fields: appendNote(card, actor, now, parsed.text), wrote: true };
}

/**
 * Fix what a card says: its title, its hints, its kind, its priority, and what it waits for.
 *
 * The holder decides for a held card and anyone decides for an unclaimed one — and
 * that includes a `done` card, because a title is what a reader reads, not a step of
 * the work. Every field is optional and an absent one is left alone; a field that already
 * holds the value asked for is not a write, so re-editing the same card is a no-op.
 */
export function edit(card: Card, op: Extract<CardOp, { kind: "edit" }>, actor: Actor, board: BoardIndex): Prepared {
	if (card.owner !== undefined && !holds(card, actor)) {
		return { error: `${heldBy(card)} Only its owner can edit it.` };
	}
	const fields: Partial<Card> = {};
	if (op.title !== undefined) {
		const parsed = normalizeTitle(op.title);
		if ("error" in parsed) return { error: parsed.error };
		if (parsed.title !== card.title) fields.title = parsed.title;
	}
	if (op.paths !== undefined) {
		const parsed = normalizePathHints(op.paths);
		if ("error" in parsed) return { error: parsed.error };
		if (!sameList(parsed.paths, card.paths)) fields.paths = parsed.paths;
	}
	if (op.type !== undefined) {
		const parsed = normalizeType(op.type);
		if ("error" in parsed) return { error: parsed.error };
		if (parsed.type !== card.type) fields.type = parsed.type;
	}
	if (op.breaking !== undefined) {
		const parsed = normalizeBreaking(op.breaking);
		if ("error" in parsed) return { error: parsed.error };
		// Clearing the marker removes the key rather than writing `false`, so a card that was
		// never breaking reads back exactly like one that stopped being.
		if (parsed.breaking !== breakingOf(card)) fields.breaking = parsed.breaking ? true : undefined;
	}
	if (op.priority !== undefined) {
		const parsed = normalizePriority(op.priority);
		if ("error" in parsed) return { error: parsed.error };
		if (parsed.priority !== priorityOf(card)) fields.priority = parsed.priority;
	}
	if (op.dependsOn !== undefined) {
		const parsed = normalizeDepends(op.dependsOn, card, board);
		if ("error" in parsed) return { error: parsed.error };
		if (!sameList(parsed.dependsOn, dependsOf(card))) fields.dependsOn = parsed.dependsOn;
	}
	if (Object.keys(fields).length === 0) return { changed: false, fields: null };
	return { changed: true, fields };
}

/**
 * Record that the card was offered to the team, and nobody has taken it.
 *
 * The same preconditions a claim would meet, because the offer asks a peer to claim — and
 * they are this operation's own, not a claim run as a stand-in: a held card, a finished
 * one, one waiting on unfinished work, and a `plan` lane already at its limit are all
 * refused here, before anything is broadcast. The limit is the one a claim would meet when
 * the peer answers, so an offer can never send a handoff for work nobody can pick up.
 * Re-offering refreshes the age rather than refusing as a no-op.
 */
export function offer(card: Card, now: number, board: BoardIndex, limits: WipLimits): Prepared {
	if (LANE_RULES[card.lane].terminal) return { error: `${cardRef(card.id)} is done; it cannot be offered.` };
	if (card.owner !== undefined) return { error: heldBy(card) };
	const waiting = waitingOn(card, board);
	if (waiting !== undefined) return { error: waiting };
	const full = wipRefusal("plan", [...board.values()], limits);
	if (full !== undefined) return { error: `${cardRef(card.id)} cannot be offered: ${full}` };
	return { changed: true, fields: { offeredAt: now } };
}

/**
 * What a card set aside answers to a write, wherever the call came from.
 *
 * The archive is one way, so a card in it is history rather than work: `drop` is the only
 * operation that still applies, and it exists because a card archived by mistake has to have
 * some way out. The sentence is stated once, in the module that owns the refusals, and
 * `rules.ts` asks it before any step runs.
 */
export function closedArchive(card: Card): string {
	return `${cardRef(card.id)} is archived: its record is read-only, and \`drop\` removes it for good.`;
}

/**
 * Set a finished card aside, out of the board and into the archive beside it.
 *
 * Only a finished card leaves this way. No field moves and no transition is appended — the
 * record is unchanged, and what changed is which pile its file lies in, which is the
 * store's write. `changed` is still true, because the board lost a card.
 *
 * A card an open card still waits on stays, and the board is a parameter for that one
 * question: `archive` is one state with two doors — this one and the sweep — and the sweep
 * answers it from `round.archivable`. A named card was held to the lane rule alone, so the
 * same call the sweep refuses went through and left a `dependsOn` naming a card no read of
 * the board opens. Nothing is lost by refusing it: the link is a decision the holder can
 * undo in one `edit`.
 */
export function archive(card: Card, board: BoardIndex): Prepared {
	if (!LANE_RULES[card.lane].terminal) {
		return { error: `${cardRef(card.id)} is in ${card.lane}; only a finished card can be archived.` };
	}
	const waiting = openDependentsOf(card.id, board);
	if (waiting.length > 0) {
		const waits = waiting.length === 1 ? "waits" : "wait";
		return {
			error: `${cardRef(card.id)} is finished, and ${lanesText(waiting)} still ${waits} on it: clear the link first, or the dependency would name a card the board no longer opens.`,
		};
	}
	return { changed: true, fields: null };
}

export function drop(card: Card, actor: Actor, board: BoardIndex): Prepared {
	// A drop takes its id with it, so a card another one waits on cannot leave: the
	// remaining link would name nothing, and nothing on the board would say so.
	const depended = dependedOn(card.id, board);
	if (depended !== undefined) return { error: depended };
	const rule = LANE_RULES[card.lane];
	if (rule.ownerless || rule.terminal) return { changed: true, fields: null };
	if (!holds(card, actor)) return { error: `${heldBy(card)} It cannot be dropped while someone holds it.` };
	return { changed: true, fields: null };
}

/** Whether two string lists are the same list, in the same order. */
function sameList(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/** The owner recorded for an actor: the id only when this actor has one. */
function ownerOf(actor: Actor): CardOwner {
	return actor.id === undefined ? { label: actor.label } : { id: actor.id, label: actor.label };
}

/** The refusal for an operation on a card someone else holds. */
function heldBy(card: Card): string {
	return `${cardRef(card.id)} is held by ${card.owner?.label ?? "another session"}.`;
}

/**
 * The refusal for the session a card already belongs to: no `reclaim`, which is what a
 * third-party refusal offers, and no second handoff, which is the whole point of refusing.
 */
function alreadyHeldBy(card: Card): string {
	return `${cardRef(card.id)} is already ${card.owner?.label ?? "another session"}'s.`;
}
