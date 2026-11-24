/**
 * The gate ladder: why a call may move, sign, close or take back a card, and every sentence that says why not.
 *
 * `approve` and `review` are the board's one human judgement, so the signer is refused in two shapes — a
 * session that is not the lead (`signRefusal`), and a lead that holds the card it means to sign
 * (`holderRefusal`, release it first) — and the words live in `SIGN_WORDS` so a gate and a lane requirement
 * cannot drift into four slightly different sentences. What a sign *is* belongs to `signs.ts`; this module is
 * what a signature unlocks, and it is also where `reclaim`'s three answers live: the holder may take its own
 * card back, the lead anybody's, and a peer only from a session the bus says has stopped.
 *
 * The refusals stay here because the ladder writes them: `mayMove`, `reviewGate` and `reclaim` each build the
 * sentence for the state they found, so a module of sentences would import the decisions it answers for.
 * Pure throughout: a name compare and a string, no clock and no file.
 */

import { sameLabel } from "../session-label.ts";
import type { SessionPresence } from "../session-roster.ts";
import { type Card, cardRef, holds, normalizeNote } from "./card.ts";
import type { BoardConfig } from "./config.ts";
import {
	askLead,
	isVerification,
	type Lead,
	leadName,
	normalizeInstruction,
	SIGN_WORDS,
	type Verification,
} from "./contract.ts";
import { contractRoute, LANE_RULES, type Lane } from "./lanes.ts";
import type { Actor, Prepared } from "./rules.ts";
import {
	appendNote,
	currentReview,
	type HolderFact,
	isLead,
	isPerson,
	laneReview,
	owesAnnouncement,
	type Sign,
	signMark,
	signedAs,
} from "./signs.ts";

/**
 * Why `actor` may not sign `card`, or `undefined` when it may.
 *
 * The holder is the caller's own check: this asks only whether the actor is the person or the
 * lead, because those are the two answers the gate accepts.
 */
export function signRefusal(card: Card, actor: Actor, lead: Lead, sign: Sign): string | undefined {
	if (isPerson(actor) || isLead(actor, lead)) return undefined;
	return SIGN_WORDS[sign].notSigner(card.id, actor, lead);
}

/** What a holder is told when it means to sign its own card: what the lead does, or what it is. */
export function holderRefusal(actor: Actor, lead: Lead, sign: Sign): string {
	return isLead(actor, lead) ? SIGN_WORDS[sign].release : SIGN_WORDS[sign].holder;
}

/**
 * Whether this actor acts as the lead: the name `team.lead` gives, or the seat the board says it holds.
 *
 * Two doors need it, and the sign gates deliberately do not. A lead that does not hold the card has
 * exactly two powers — opening `execute` by approving the contract ({@link mayMove}) and taking a
 * card back from a live peer ({@link mayTakeBack}) — and both were decided by the label alone. So a
 * session serving the page under its own name (`my-pi-agent`, with `team.lead` of `gavin`) was a peer
 * at both: it was told to ask the lead for a card it was entitled to take, by a sentence naming the
 * lead at the lead (#825). The seat is the board's own statement that the session works as the lead
 * (`lib/mode-state.ts`), and a label is a name that drifts, so the seat answers the question the
 * label was standing in for.
 *
 * A sign does not read it. A signature is the person's act ({@link isPerson}) or the lead's name, and
 * the seat narrows the tool set rather than granting judgement: a seat-reading `signRefusal` would let
 * a session's agent approve the card it is working, which is what `holderRefusal` exists to stop.
 */
function leadAuthority(actor: Actor, lead: Lead): boolean {
	return isLead(actor, lead) || actor.seat === true;
}

/**
 * Why this actor may not move this card, or `undefined` when it may.
 *
 * The holder moves its own card. The lead moves one it does not hold twice: `plan → execute`, the lane its
 * approval opened, and `execute → done` where the bus says the holder left for good — a review is the
 * signature, so the close only records where a signed card went, and a vanished holder would leave it no
 * door. `holder` goes through {@link heldState}, so another session's fact is none and a quiet holder keeps its card.
 * "The lead" is {@link leadAuthority}, so a session holding the seat is one at both the door and the
 * sentence it is refused with — a seat-holder refused for `not approved yet` must hear that reason, not
 * "Only its owner can move it."
 */
export function mayMove(
	card: Card,
	actor: Actor,
	target: Lane,
	lead: Lead,
	holder?: HolderFact,
	ownerLabel?: string,
): string | undefined {
	if (holds(card, actor)) return undefined;
	if (leadAuthority(actor, lead)) {
		if (card.lane === "plan" && target === "execute") return undefined;
		const state = heldState(card, holder);
		if (target === "done" && card.lane === "execute" && (state === "gone" || state === "absent")) return undefined;
	}
	return leadAuthority(actor, lead)
		? `${heldBy(card, ownerLabel)} A lead opens \`execute\` by approving the contract; moving it stays the holder's.`
		: `${heldBy(card, ownerLabel)} Only its owner can move it.`;
}

/**
 * What a lead is refused with when it reaches for a verb that is still the holder's.
 *
 * A lead opens `execute` by approving, so `move` admits it for that one transition and nothing else.
 * The sentence names the door that *is* open, because "only its owner can move it" would be false for
 * the one case a lead is about to try — and a refusal that states something false teaches the next
 * session to work around the gate rather than to read it.
 */
export function leadCannot(card: Card, verb: string, ownerLabel?: string): string {
	return `${heldBy(card, ownerLabel)} A lead opens \`execute\` by approving the contract; ${verb} stays the holder's.`;
}

/**
 * Who holds the card, as every refusal that is about a holder opens.
 *
 * `ownerLabel` is the name the bus shows for the owner's session id, when the caller could read it:
 * a record's label is the name a claim captured, and a session that was renamed since leaves the
 * record holding a name nobody answers to — the refusal it printed read like a lost holder while the
 * holder was alive. The record's label stays as the fallback for an id the bus has dropped, and when
 * even that is empty the id is printed rather than a phrase: "another session" is the answer for a
 * card nobody holds, and using it where the holder is known hides a fact a reader needs.
 */
export function heldBy(card: Card, ownerLabel?: string): string {
	const owner = card.owner;
	const named = ownerLabel ?? (owner === undefined ? undefined : owner.label !== "" ? owner.label : owner.id);
	return `${cardRef(card.id)} is held by ${named ?? "another session"}.`;
}

/** What a lane that needs a sign nobody gave says: the lead approves it, or the person signs. */
export function missingSign(card: Card, lead: Lead, sign: Sign): string {
	return SIGN_WORDS[sign].missing(card.id, lead);
}

/**
 * What a `done` move is refused with when the contract named a command and the sign has no run.
 *
 * A card that names one is not spot-checked by a sentence any more, and the refusal is the place
 * that says so: it names the command, and both doors that would record it, because "review it
 * again" alone leaves a reader guessing which of the two they have.
 */
export function unverifiedSpotCheck(card: Card, cmd: string, lead: Lead): string {
	return `${cardRef(card.id)}'s contract names \`${cmd}\`, and its spot-check carries no result: the lead (${leadName(lead)}) records one with \`review\` or \`/board review ${card.id}\`.`;
}

/**
 * What a `done` move is refused with when the contract names no command at all.
 *
 * Only a card written before the fourth line was required — or one hand-edited — has none, so the
 * refusal names the line, the route its lane takes to record it (`contractRoute`, because `contract`
 * is refused outside `plan`), and the approval that costs: this is the sentence that says so first.
 */
export function noVerifyCommand(card: Card, lead: Lead): string {
	return `${cardRef(card.id)}'s contract names no \`verify\` command, so there is no run for its spot-check: its holder's route — ${contractRoute(card)} The approval that drops is signed again by the lead (${leadName(lead)}), with \`approve\` or \`/board approve ${card.id}\`.`;
}

/**
 * What a `done` move is refused with when the run is older than the card it vouches for.
 *
 * A write that changes the card after the sign — an edit, a second move, a sign — moves it under the
 * evidence, so the run is made again; a note is a message about the card, and `stateAt` is compared.
 */
export function staleSpotCheck(card: Card, cmd: string, lead: Lead): string {
	return `${cardRef(card.id)} was written after its spot-check, so the run no longer speaks for it — run \`${cmd}\` and review again: the lead (${leadName(lead)}) with \`review\` or \`/board review ${card.id}\`.`;
}

/**
 * Why the card may not be closed for want of a spot-check, or `undefined` when its sign speaks for
 * it: the whole rule the `done` gate asks, in the module that owns signs.
 *
 * The order is the one a reader acts on — no sign for this execution says "record one", a contract
 * naming no command is the line to record, a sign with no run is the run — and only then is an
 * outgrown sign the same run made again, because "the run no longer speaks for this card" is not
 * "the card was never checked". `laneReview` answers the first question and `currentReview` the
 * last, so the gate and the reason line cannot tell a card two different stories about one sign.
 */
export function spotCheckRefusal(card: Card, lead: Lead): string | undefined {
	const made = laneReview(card);
	if (made === undefined) return missingSign(card, lead, "review");
	// The contract's command is the only run worth evidence, so a card that names none is refused a
	// sign rather than spot-checked by a sentence: only a card written before the line was required,
	// or one hand-edited, has none, and the refusal names the line and the approval recording it costs.
	const cmd = card.contract?.verify;
	if (cmd === undefined) return noVerifyCommand(card, lead);
	if (made.verified === undefined) return unverifiedSpotCheck(card, cmd, lead);
	return currentReview(card) === undefined ? staleSpotCheck(card, cmd, lead) : undefined;
}

/** What a `review` is refused with when the command it ran did not pass. */
export function failedSpotCheck(card: Card, cmd: string, exit: number): string {
	return `\`${cmd}\` exited ${exit}, so ${cardRef(card.id)} was not spot-checked.`;
}

/** What a `review` is refused with when the command outlived the bound the board gives it. */
export function killedSpotCheck(card: Card, cmd: string, boundMs: number): string {
	const minutes = Math.max(1, Math.round(boundMs / 60_000));
	return `\`${cmd}\` did not finish within ${minutes} minutes, so ${cardRef(card.id)} was not spot-checked.`;
}

/**
 * What a result says when the card's owner did not hear about a sign.
 *
 * Two doors write a sign — the tool, and the person's `/board approve` — and each sends by the
 * one bus transport its context allows, so a bus that cannot answer costs both a line on the
 * result. The sentence is one body so a reader of either transcript is told the same fact in
 * the same words, and the signature is recorded either way, which is why this is a line on a
 * result and never a refusal.
 */
export function notToldLine(owner: string, reason: string): string {
	return `${owner} was not told (${reason})`;
}

/**
 * The refusals a spot-check answers before it is asked for evidence — the word, the lane, the holder,
 * the signer and the note the sign would carry, all decided without the run. Its own function because
 * two callers ask at different moments: a door asks before it starts the command a contract names,
 * {@link review} again under the write's lock, and one owner is what keeps the cheap answer from
 * drifting from the decision.
 */
export function reviewGate(
	card: Card,
	actor: Actor,
	lead: Lead,
	override?: unknown,
	note?: unknown,
): { instruction?: string } | { error: string } {
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
	if (holds(card, actor)) return { error: `${heldBy(card)} ${holderRefusal(actor, lead, "review")}` };
	const wrongSigner = signRefusal(card, actor, lead, "review");
	if (wrongSigner !== undefined) return { error: wrongSigner };
	// The note rides the sign, and the card keeps it or refuses it without asking anything else — so
	// it is asked here, last: after the refusals that mean the card cannot be signed at all, and
	// before the command a review runs, which a note the card cannot hold would only waste.
	if (note !== undefined) {
		const parsed = normalizeNote(note);
		if ("error" in parsed) return { error: parsed.error };
	}
	return instruction === undefined ? {} : { instruction: instruction.text };
}

/**
 * Record the spot-check of finished work: the lead's, and never the holder's.
 *
 * `override` is the other way a finished card gets a sign — somebody saying the gate was jumped: the reason
 * is required, the card already `done`, and no review on it, because the one rule it relaxes is the lane and
 * a reason is not a second signature. The sign records how it was made. `verified` is the run the signer's
 * own call made, held by {@link evidenceFor} rather than trusted.
 */
export function review(
	card: Card,
	actor: Actor,
	now: number,
	config: BoardConfig,
	text?: unknown,
	override?: unknown,
	verified?: unknown,
): Prepared {
	// `reviewGate` is asked again under the lock: a door cannot record a sign it skipped.
	const gate = reviewGate(card, actor, config.lead, override, text);
	if ("error" in gate) return { error: gate.error };
	const instruction = gate.instruction;
	const evidence = evidenceFor(card, config, instruction !== undefined, verified);
	if ("error" in evidence) return { error: evidence.error };
	// The record on the card, whether or not it still speaks for it: an override is refused by a sign
	// that exists, while `currentReview` decides whether this call re-makes the stamp.
	const made = laneReview(card);
	const already = currentReview(card);
	const signed = signedAs(already, actor, config.lead);
	// A sign is a fact about a person and a moment, so an override never replaces one: it is how a
	// card with no spot-check gets a record, not how a record gets a different author.
	if (instruction !== undefined && made !== undefined && !(signed && made.byInstruction !== undefined)) {
		return {
			error: `${cardRef(card.id)} is already spot-checked by ${made.by}; an override signs a card that has no sign.`,
		};
	}
	const noted = signNote(card, text, actor, now);
	if ("error" in noted) return { error: noted.error };
	// The same rule as `approve`: a sign owes its message, and a repeat owes it while untold — the
	// only way a failed send is ever re-sent.
	const owes = owesAnnouncement(card, "review", actor, config.lead);
	// A repeat sign re-makes the stamp when it is saying something the card did not record yet
	// (`noted`). A sign the card has outgrown is not `signed` at all — `currentReview` drops it — so
	// the same call stamps afresh, which is the remedy the `done` gate's "review again" names and the
	// one a repeat could not perform while the stale sign still read as current. Only a sign that says
	// nothing, on a card it still speaks for, is the no-op the repeat rule keeps.
	const redo = signed && instruction === undefined && noted.wrote;
	// A sign that is already there and stays: nothing to stamp, and an untold one still owes its
	// message. An override's repeat is one of these but its note is still a write, so it falls
	// through to the note-only return below.
	const repeat = signed && !redo;
	if (repeat && !noted.wrote) return { changed: false, fields: null, ...(owes ? { announce: true as const } : {}) };
	// Not older than the card it signs: a stamp the card has passed can never speak for it (`signStale`).
	const signedAt = Math.max(now, card.updatedAt);
	const stamp =
		instruction === undefined
			? { ...signMark(actor, config.lead), at: signedAt }
			: { ...signMark(actor, config.lead), at: signedAt, byInstruction: instruction };
	// The run rides the stamp it is evidence for. A re-made sign takes this call's run, because the
	// old one vouched for the card as it was before the write that made the stamp stale.
	const stamped = evidence.verified === undefined ? stamp : { ...stamp, verified: evidence.verified };
	// A repeat that only speaks (an override's note, a sign already there) keeps the stamp it found;
	// a re-made one replaces it, so the card's clock can never be newer than the sign it vouches for.
	const spotCheck = repeat ? {} : { review: stamped };
	// A fresh stamp drops its `told`, so it owes the message its owner already heard for the sign it
	// replaced: a re-made sign is a new fact, and the announcement is a write of its own.
	const notice = owes || redo;
	// As with `approve`: a second signer's note moves the card, and the owner's message follows the
	// stamp — or the untold sign a repeat still owes them.
	return { changed: true, fields: { ...spotCheck, ...noted.fields }, ...(notice ? { notice: "review" as const } : {}) };
}

/**
 * The run a spot-check carries, or the reason it cannot.
 *
 * The contract's command is the only one worth evidence: a result for any other command would vouch
 * for something the card never promised, and a result for the *old* command is the failure this
 * whole rule exists to prevent — a reviewer's green standing over wording the card has since
 * changed. An override carries none: dressing a close in a run would read as a check.
 */
function evidenceFor(
	card: Card,
	config: BoardConfig,
	instruction: boolean,
	raw: unknown,
): { verified?: Verification } | { error: string } {
	if (raw === undefined) {
		// Fail closed where a command is named: the card asked for a run, and a sign without one is
		// the belief this gate replaced.
		const named = card.contract?.verify;
		if (named !== undefined && !instruction) return { error: unverifiedSpotCheck(card, named, config.lead) };
		return {};
	}
	if (instruction) return { error: `${cardRef(card.id)}'s override carries no run; an instruction is not a check.` };
	if (!isVerification(raw)) return { error: `${cardRef(card.id)}'s run is not a command, an exit, and a moment.` };
	const named = card.contract?.verify;
	if (named === undefined) {
		return { error: `${cardRef(card.id)}'s contract names no command, so there is no run to record.` };
	}
	if (named !== raw.cmd) {
		return { error: `${cardRef(card.id)}'s contract names \`${named}\`, not \`${raw.cmd}\`; review the card again.` };
	}
	if (raw.exit !== 0) return { error: failedSpotCheck(card, raw.cmd, raw.exit) };
	return { verified: raw };
}

/**
 * The note a signer leaves with the sign, in the same write.
 *
 * Validated after the gate, as `note` validates after the holder check: a card that cannot be
 * signed at all is the answer worth reading first. The gate asks this same rule before any run
 * (`reviewGate`); this call is what keeps a store reached some other way from recording a note it
 * cannot keep.
 */
export function signNote(
	card: Card,
	raw: unknown,
	actor: Actor,
	now: number,
): { fields: Partial<Card>; wrote: boolean } | { error: string } {
	if (raw === undefined) return { fields: {}, wrote: false };
	const parsed = normalizeNote(raw);
	if ("error" in parsed) return { error: parsed.error };
	return { fields: appendNote(card, actor.label, now, parsed.text), wrote: true };
}

/**
 * Take a card back to the pool, for the callers this module already answers for.
 *
 * The holder may always, the person and the lead may take anybody's, and a peer only when the bus says
 * the owner has stopped — `quiet` or `gone`. `absent` is refused like no fact at all: a live session that
 * never joined this bus has no record either, so no record is not an answer.
 */
export function reclaim(card: Card, actor: Actor, config: BoardConfig, holder?: HolderFact, swept = false): Prepared {
	if (LANE_RULES[card.lane].terminal) {
		return { error: `${cardRef(card.id)} is done; there is nothing to reclaim.` };
	}
	if (card.owner === undefined) return { error: `${cardRef(card.id)} has no owner to reclaim.` };
	const state = heldState(card, holder);
	if (!mayTakeBack(card, actor, config.lead, state)) return { error: heldStill(card, config.lead, state) };
	// The holder releasing its own card has nothing to hear; a reclaim that takes it from somebody
	// is the transition that owes them a message.
	return {
		changed: true,
		fields: backToPool(card, actor, config.lead, swept),
		...(holds(card, actor) ? {} : { notice: "reclaim" as const }),
	};
}

/** Whether this caller may take the card back. */
function mayTakeBack(card: Card, actor: Actor, lead: Lead, state: SessionPresence | undefined): boolean {
	if (holds(card, actor) || isPerson(actor) || leadAuthority(actor, lead)) return true;
	return state === "quiet" || state === "gone";
}

/** The bus's answer about the card's holder, when the fact belongs to the owner the card names. */
export function heldState(card: Card, holder: HolderFact | undefined): SessionPresence | undefined {
	const owner = card.owner;
	if (owner === undefined || holder === undefined) return undefined;
	// A handoff the bus could not resolve is nobody's by label, so the fact binds to no caller.
	if (owner.handoff?.unresolved === true) return undefined;
	// The order `holds` compares in: the two ids when both sides have one, else the label.
	const same =
		owner.id !== undefined && holder.owner.id !== undefined
			? owner.id === holder.owner.id
			: sameLabel(owner.label, holder.owner.label);
	return same ? holder.state : undefined;
}

/**
 * What a card looks like back in the pool: nobody's, and its spot-check unless its signer took it.
 *
 * `swept` is the turn-start sweep, which is nobody acting: it keeps the sign it finds, because holding
 * the seat is not withdrawing a judgement — only the signer's own reclaim is (#836).
 */
function backToPool(card: Card, actor: Actor, lead: Lead, swept = false): Partial<Card> {
	return {
		lane: "backlog",
		owner: undefined,
		offeredAt: undefined,
		// A spot-check is evidence that somebody looked at the work, and taking the card back is not
		// a look: only the signer withdraws their own sign, so a third session keeps what it found.
		review: swept || !signedAs(card.review, actor, lead) ? card.review : undefined,
	};
}

/**
 * Why this caller may not take the card back, in the three shapes the bus leaves.
 *
 * A sentence each, because the caller's next move differs: a running peer is asked to release, a
 * session the bus has never recorded cannot be asked, and a board with no bus at all has nothing
 * to go on.
 *
 * Since #825 the session that holds the seat is never refused here, so this cannot be printed at a
 * lead: the reader it addresses is a peer, for whom "ask the owner to release it, or ask the lead"
 * is exactly true. It names no `/board` hatch on purpose — `/board` can start `attached` and take no
 * seat, so a hatch that names a door the command does not open is worse than none.
 */
function heldStill(card: Card, lead: Lead, state: SessionPresence | undefined): string {
	const owner = card.owner?.label ?? "another session";
	const held = `${cardRef(card.id)} is held by ${owner}.`;
	if (state === "live") {
		return `${held} That session is running, so only the lead (${leadName(lead)}) takes a live peer's card back — ask ${owner} to release it, or ${askLead(lead)}.`;
	}
	if (state === "absent") {
		return `${held} The bus has no record of that session, and nothing says it stopped: only the lead (${leadName(lead)}) takes the card back.`;
	}
	return `${held} Nothing here says whether that session is running, so only the lead (${leadName(lead)}) takes the card back.`;
}
