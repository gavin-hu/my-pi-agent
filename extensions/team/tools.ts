/**
 * The `team` tool: the lead's round over the same cards `board` owns.
 *
 * Four actions, because they are the four a lead takes at the round: hand a card out,
 * offer it, take one back, and take one itself. `assign` sends the handoff **first** and
 * sets the owner **second**: a card assigned without a message is a card nobody knows
 * about, while a message for a card that then changed is one the peer can still claim.
 * Either failure is reported with the card as it actually is, so the lead's next call
 * starts from the truth.
 *
 * `claim` is the lead's own work, and it is the same store operation `board`'s claim
 * makes, so the lane rules, the WIP limit, and the offer record cleared are the store's —
 * not a second answer the round would keep in step by hand. Everything after the claim
 * (plan, contract, move, finish) is `board`'s, because that is the card's life and not
 * the round's.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import { type Card, cardRef, normalizeCardId } from "../../lib/board/card.ts";
import { indexOf } from "../../lib/board/links.ts";
import { type Actor, mayOp } from "../../lib/board/rules.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import type { BoardStore } from "../../lib/board/store.ts";
import { messageOf } from "../../lib/errors.ts";
import type { TeamJoin } from "../../lib/session-tool.ts";
import { failedResult, type ToolFailure, textResult } from "../../lib/tool-result.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { callLine, detailsOrLine } from "../../lib/tui/tool.ts";
import { plural } from "../../lib/board/round-text.ts";
import { strayField } from "../../lib/stray-fields.ts";
import {
	actorFor,
	type Dispatch,
	handoffText,
	notListening,
	offerText,
	ownerFor,
	sessionDispatch,
} from "./dispatch.ts";
import {
	formatClaimed,
	formatHandoff,
	formatHandoffFailure,
	formatOffer,
	formatOfferFailure,
	formatRacedOffer,
	formatRacedAssignment,
	formatReclaimed,
} from "./format.ts";
import { TeamParams } from "./schema.ts";
import {
	ACTION_FIELDS,
	normalizeTeamAction,
	TEAM_ACTIONS,
	TEAM_TOOL,
	type TeamAction,
	type TeamDetails,
} from "./types.ts";

/** The parameters as the schema validates them. */
type TeamArgs = Static<typeof TeamParams>;

/** One refusal: the reason for the model, the state for the renderer. */
function refusal(action: TeamAction, message: string, card?: Card): ToolFailure<TeamDetails> {
	return failedResult(`Error: ${message}`, { action, error: message, ...(card === undefined ? {} : { card }) });
}

/** The call line's subject: the verb, the card, and the peer it names. */
function callSubject(action: TeamAction, args: Record<string, unknown>): string {
	const card = typeof args.card === "string" && args.card.trim() !== "" ? cardRef(args.card.trim()) : "";
	const to = typeof args.to === "string" && args.to.trim() !== "" ? ` → ${args.to.trim()}` : "";
	return card === "" ? action : `${action} ${card}${action === "assign" ? to : ""}`;
}

/** What the tool needs from the outside, so a suite drives it without a bus. */
export interface TeamToolsDeps {
	/** Test seam: the handoff transport. */
	dispatch?: (ctx: Parameters<typeof sessionDispatch>[0]) => Dispatch;
	/** Test seam: the join a claim makes, so a suite records it instead of asking a bus. */
	team?: TeamJoin;
}

export function registerTools(pi: ExtensionAPI, session: BoardSession, deps: TeamToolsDeps = {}): void {
	const dispatchFor = deps.dispatch ?? sessionDispatch;
	/** The join, built on the first claim: a round that never takes a card pays nothing. */
	let joinBuilder: Promise<TeamJoin> | undefined;
	const teamFor = (): Promise<TeamJoin> => {
		if (deps.team !== undefined) return Promise.resolve(deps.team);
		joinBuilder ??= import("../../lib/session-tool.ts").then(({ createTeamJoin }) => createTeamJoin(pi));
		return joinBuilder;
	};

	pi.registerTool({
		name: TEAM_TOOL,
		label: "Team",
		description:
			"Run a round of work over the shared board: `assign` hands a card to a running session and sends it a handoff " +
			"(`to` is a teammate's label or id, as `/team` lists them); `offer` broadcasts an unclaimed card to every other " +
			"live session and writes nothing, so the first to claim it takes it; `reclaim` takes a card back to Backlog and " +
			"sends nothing, so it needs no team; `claim` takes one for yourself, and the card's plan, contract, moves, and " +
			"finish are `board`'s. Nothing here starts a peer's turn: a message waits in its inbox, and a peer that is " +
			"listening reports it at its next turn.",
		promptSnippet:
			"Run a round over the board: assign a card to a running session, offer one, reclaim one, or claim one.",
		promptGuidelines: [
			"Open the board with `/board` or work a card first, so this session and its peers are on the team.",
			"Offer a card nobody has taken; assign one you mean a particular peer to hold; claim one you will take " +
				"yourself, then plan and record it with `board`.",
			"When a result says `Not listening`, say so: the message waits for that peer's next turn.",
			"Reclaim a card whose owner is gone or has gone quiet rather than editing someone else's work. A " +
				"`gone:` owner's process is not running, so what it held is anyone's to reclaim.",
		],
		parameters: TeamParams,
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as TeamArgs;
			const action = normalizeTeamAction(args.action);
			if (!action) {
				return refusal("assign", `unknown action "${String(args.action)}"; use ${TEAM_ACTIONS.join(" or ")}.`);
			}
			// Before the store and before the card: a refused call has done nothing, so it
			// cannot have read a card or sent a message on its way to the refusal.
			const stray = strayField(action, args, ACTION_FIELDS);
			if (stray !== undefined) return refusal(action, stray);
			const id = normalizeCardId(args.card);
			if (id === undefined) return refusal(action, `"${String(args.card)}" is not a card id.`);
			const me = await session.who(ctx, ctx.cwd);
			try {
				const store = await session.store(ctx.cwd);
				const now = session.now();
				if (action === "reclaim") return await reclaimCard(store, me, id, now);
				if (action === "offer") return await offerCard(store, me, id, args.note, now, dispatchFor(ctx));
				if (action === "claim") return await claimCard(store, session, teamFor, ctx, me, id, now);
				const to = typeof args.to === "string" ? args.to.trim() : "";
				if (to === "") return refusal("assign", 'assign needs a peer: pass `to`, e.g. "billing-core".');
				return await assignCard(store, me, id, to, args.note, now, dispatchFor(ctx));
			} catch (error) {
				return refusal(action, messageOf(error));
			}
		},

		renderCall(args, theme, context) {
			const action = normalizeTeamAction(args.action) ?? "assign";
			return callLine(theme, context.lastComponent, TEAM_TOOL, callSubject(action, args as Record<string, unknown>));
		},

		renderResult(result, _options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const details = toolDetails<TeamDetails>(result.details);
			const outcome = detailsOrLine(theme, result, false, details);
			text.setText("line" in outcome ? outcome.line : summaryOf(outcome.details));
			return text;
		},
	});
}

/**
 * `assign`: check the preconditions, send the handoff, then set the owner.
 *
 * The preconditions are checked with `mayOp`, the same decision the store's `applyOp` will
 * make — and with the store's own limits, so a configured WIP cap is the one the precheck
 * sees — so an assignment the rules would refuse never sends a message at all.
 */
async function assignCard(
	store: BoardStore,
	me: Actor,
	id: string,
	to: string,
	note: string | undefined,
	now: number,
	dispatch: Dispatch,
): Promise<ReturnType<typeof textResult<TeamDetails>> | ToolFailure<TeamDetails>> {
	const card = await store.read(id);
	if (!card) return refusal("assign", `${cardRef(id)} does not exist.`);
	// A handoff to yourself is not a claim: it writes a message into your own inbox and
	// records you as the owner without the claim's next step. `claim` is that act.
	if (namesSelf(me, to))
		return refusal("assign", `${cardRef(id)} cannot be handed to yourself: \`claim\` takes one.`, card);
	// Who `to` names, asked before the check and once: a card records the id the bus gave its
	// holder, and `holds` compares ids first, so an id the caller typed has to be resolved to
	// the peer it names rather than compared as a label. The same actor is what the write
	// records, so the check and the write cannot disagree about who `to` is.
	const peers = await dispatch.peers().catch(() => undefined);
	const target = actorFor(peers, to);
	// The board, not just the card: a card that waits on unfinished work, or a `plan` lane
	// with no room, is refused here, so a handoff for it is never sent. `mayOp` is the
	// store's own check without the write, and the board's settings are the store's, not a default.
	const refused = mayOp(card, { kind: "assign", to: target }, me, indexOf(await store.list()), store.config());
	if (refused !== undefined) return refusal("assign", refused, card);

	let delivered: string[];
	try {
		delivered = (await dispatch.send({ kind: "handoff", to, text: handoffText(card, to, store.config().lead, note) }))
			.delivered;
	} catch (error) {
		return refusal("assign", formatHandoffFailure(card, to, messageOf(error)), card);
	}

	// The owner a handoff records: the resolved peer, whose id survives the peer renaming
	// itself, or the label a message file was written for when the bus could not say who that
	// is. The same read also says whether that peer will be woken by the message it just got.
	const applied = await store.mutate(
		id,
		{ kind: "assign", to: target.id === undefined ? ownerFor(to, delivered) : target },
		me,
		now,
	);
	if (!applied.ok)
		return refusal("assign", formatRacedAssignment(applied.card ?? card, to, applied.error), applied.card ?? card);
	const silent = notListening(peers, delivered);
	return textResult(formatHandoff(applied.card, to, delivered, silent), {
		action: "assign",
		card: applied.card,
		assigned: applied.card.owner,
		delivered,
		...(silent.length === 0 ? {} : { notListening: silent }),
	});
}

/**
 * `offer`: check the claim's preconditions, broadcast the card, then record the offer.
 *
 * The broadcast comes first and the record second, because a record of an offer nobody
 * received would be worse than an offer with no record: the card is unchanged by a failed
 * send, and the first peer to claim is what makes an offer into work. What the record
 * adds is the one thing an event cannot carry — when it was made — so a lead can tell an
 * offer nobody took from a card nobody has looked at.
 */
async function offerCard(
	store: BoardStore,
	me: Actor,
	id: string,
	note: string | undefined,
	now: number,
	dispatch: Dispatch,
): Promise<ReturnType<typeof textResult<TeamDetails>> | ToolFailure<TeamDetails>> {
	const card = await store.read(id);
	if (!card) return refusal("offer", `${cardRef(id)} does not exist.`);
	// The board, not just the card: a card that waits on unfinished work, one somebody
	// holds, or a `plan` lane with no room is refused here, so a broadcast for it is never
	// sent. This is the offer's own rule, asked without the write.
	const refused = mayOp(card, { kind: "offer" }, me, indexOf(await store.list()), store.config());
	if (refused !== undefined) return refusal("offer", refused, card);

	let delivered: string[];
	try {
		delivered = (await dispatch.send({ kind: "event", to: "*", text: offerText(card, store.config().lead, note) }))
			.delivered;
	} catch (error) {
		return refusal("offer", formatOfferFailure(card, messageOf(error)), card);
	}
	// The peers have the event, so a card that changed underneath is reported as raced
	// rather than refused: the message is already in their inboxes.
	const recorded = await store.mutate(id, { kind: "offer" }, me, now);
	if (!recorded.ok) return refusal("offer", formatRacedOffer(recorded.card ?? card, recorded.error), recorded.card);
	const peers = await dispatch.peers().catch(() => undefined);
	const silent = notListening(peers, delivered);
	return textResult(formatOffer(recorded.card, delivered, silent), {
		action: "offer",
		card: recorded.card,
		delivered,
		...(silent.length === 0 ? {} : { notListening: silent }),
	});
}

/** Whether `to` names this session: its id, or its label ignoring case. */
function namesSelf(me: Actor, to: string): boolean {
	const target = to.trim();
	return (me.id !== undefined && target === me.id) || target.toLowerCase() === me.label.toLowerCase();
}

/**
 * `claim`: the lead takes a card itself, through the store operation `board`'s claim makes.
 *
 * The lane rules, the WIP limit, the waiting refusal, and the offer record cleared are the
 * store's, so the two doors cannot answer them differently. The join is the claim's one
 * side effect outside the card: taking work is what makes this session a teammate, and it
 * is the same ask-once call `board` makes.
 */
async function claimCard(
	store: BoardStore,
	session: BoardSession,
	teamFor: () => Promise<TeamJoin>,
	ctx: ExtensionContext,
	me: Actor,
	id: string,
	now: number,
): Promise<ReturnType<typeof textResult<TeamDetails>> | ToolFailure<TeamDetails>> {
	const before = await store.read(id);
	if (!before) return refusal("claim", `${cardRef(id)} does not exist.`);
	const result = await store.mutate(id, { kind: "claim" }, me, now);
	if (!result.ok) return refusal("claim", result.error, result.card ?? before);
	// Both loaded here, not at registration: a round that never takes a card pays nothing
	// for the bus, and the registration graph stays the size it was.
	const { joinOnce } = await import("../../lib/board/join.ts");
	await joinOnce(session.team, await teamFor(), ctx, me.label);
	return textResult(formatClaimed(result.card), { action: "claim", card: result.card });
}

/** `reclaim`: the owner clears and the card returns to the pool, notes and all. */
async function reclaimCard(
	store: BoardStore,
	me: Actor,
	id: string,
	now: number,
): Promise<ReturnType<typeof textResult<TeamDetails>> | ToolFailure<TeamDetails>> {
	const before = await store.read(id);
	if (!before) return refusal("reclaim", `${cardRef(id)} does not exist.`);
	const previous = before.owner?.label;
	if (previous === undefined) return refusal("reclaim", `${cardRef(id)} has no owner to reclaim.`, before);
	const result = await store.mutate(id, { kind: "reclaim" }, me, now);
	if (!result.ok) return refusal("reclaim", result.error, result.card ?? before);
	return textResult(formatReclaimed(result.card, previous), { action: "reclaim", card: result.card });
}

/** The collapsed line for a successful call, from its details. */
function summaryOf(details: TeamDetails): string {
	const card = details.card;
	if (!card) return details.action === "reclaim" ? "reclaimed" : "handed off";
	if (details.action === "claim") return `${cardRef(card.id)} claimed`;
	if (details.action === "offer") {
		const count = details.delivered?.length ?? 0;
		return `${cardRef(card.id)} offered to ${plural(count, "session")}`;
	}
	const who = details.assigned?.label ?? card.owner?.label;
	const target = details.action === "assign" && who !== undefined ? ` → ${who}` : "";
	return `${cardRef(card.id)} ${card.lane}${target}`;
}
