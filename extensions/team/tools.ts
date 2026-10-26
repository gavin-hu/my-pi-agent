/**
 * The `team` tool: the lead's round over the same cards `board` owns.
 *
 * Two actions, because those are the two that need the bus. `assign` sends the
 * handoff **first** and sets the owner **second**: a card assigned without a message
 * is a card nobody knows about, while a message for a card that then changed is one
 * the peer can still claim. Either failure is reported with the card as it actually
 * is, so the lead's next call starts from the truth.
 *
 * `reclaim` needs no message — it is the compensation for a dispatch that did not
 * land — and it belongs here rather than in `board` because it only makes sense in
 * the lead's context.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import { type Card, cardRef, normalizeCardId } from "../../lib/board/card.ts";
import { indexOf } from "../../lib/board/links.ts";
import { type Actor, applyOp } from "../../lib/board/rules.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import type { BoardStore } from "../../lib/board/store.ts";
import { messageOf } from "../../lib/errors.ts";
import { failedResult, type ToolFailure, textResult } from "../../lib/tool-result.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { callLine, detailsOrLine } from "../../lib/tui/tool.ts";
import { plural } from "../../lib/board/round-text.ts";
import { strayField } from "../../lib/stray-fields.ts";
import { type Dispatch, handoffText, notListening, offerText, ownerFor, peerFor, sessionDispatch } from "./dispatch.ts";
import {
	formatHandoff,
	formatHandoffFailure,
	formatOffer,
	formatOfferFailure,
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
}

export function registerTools(pi: ExtensionAPI, session: BoardSession, deps: TeamToolsDeps = {}): void {
	const dispatchFor = deps.dispatch ?? sessionDispatch;

	pi.registerTool({
		name: TEAM_TOOL,
		label: "Team",
		description:
			"Run a round of work over the shared board: `assign` hands a card to a running session and sends it a handoff " +
			"(`to` is a teammate's label or id, as `/team` lists them); `offer` broadcasts an unclaimed card to every other " +
			"live session and writes nothing, so the first to claim it takes it; `reclaim` takes a card back to To do and " +
			"sends nothing, so it needs no team. Use `board` for everything else. Nothing here starts a peer's turn: a " +
			"message waits in its inbox, and a peer that is listening reports it at its next turn.",
		promptSnippet: "Run a round over the board: assign a card to a running session, offer one, or reclaim one.",
		promptGuidelines: [
			"Open the board with `/board` or work a card first, so this session and its peers are on the team.",
			"Offer a card nobody has taken; assign one you mean a particular peer to hold.",
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
			const me = session.who(ctx, ctx.cwd);
			try {
				const store = await session.store(ctx.cwd);
				const now = session.now();
				if (action === "reclaim") return await reclaimCard(store, me, id, now);
				if (action === "offer") return await offerCard(store, id, args.note, now, dispatchFor(ctx));
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
 * The preconditions are checked with the same `applyOp` the store will use, so an
 * assignment the rules would refuse never sends a message at all.
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
	const owner: Actor = { label: to };
	// The board, not just the card: a card that waits on unfinished work is refused here,
	// so a handoff for it is never sent.
	const dry = applyOp(card, { kind: "assign", to: owner }, me, now, indexOf(await store.list()));
	if (!dry.ok) return refusal("assign", dry.error, card);

	let delivered: string[];
	try {
		delivered = (await dispatch.send({ kind: "handoff", to, text: handoffText(card, to, note) })).delivered;
	} catch (error) {
		return refusal("assign", formatHandoffFailure(card, to, messageOf(error)), card);
	}

	// Ask the bus which session answers to the label: an owner recorded with its id
	// survives the peer renaming itself, which a label alone does not — and the same read
	// says whether that peer will be woken by the message it just got.
	const peers = await dispatch.peers().catch(() => undefined);
	const peer = peerFor(peers, to);
	const applied = await store.mutate(
		id,
		{ kind: "assign", to: peer === undefined ? ownerFor(to, delivered) : { id: peer.id, label: peer.label } },
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
 * The actor an offer's preconditions are judged as: nobody in particular.
 *
 * `claim` is what the offer asks a peer to do, so the dry run is a claim by someone who
 * holds nothing — the rules' own refusals decide whether a card may be offered at all,
 * without a second copy of the sentences.
 */
const OFFER_CLAIMANT: Actor = { label: "*" };

/**
 * `offer`: check the claim's preconditions, broadcast the card, and write nothing.
 *
 * The order matters less here than in `assign`, because nothing is written: a failed
 * broadcast leaves the card exactly as it was, and the first peer to claim is what makes
 * an offer into work. Two peers racing are settled by the store's compare-and-set.
 */
async function offerCard(
	store: BoardStore,
	id: string,
	note: string | undefined,
	now: number,
	dispatch: Dispatch,
): Promise<ReturnType<typeof textResult<TeamDetails>> | ToolFailure<TeamDetails>> {
	const card = await store.read(id);
	if (!card) return refusal("offer", `${cardRef(id)} does not exist.`);
	// The board, not just the card: a card that waits on unfinished work, or one somebody
	// holds, is refused here, so a broadcast for it is never sent.
	const dry = applyOp(card, { kind: "claim" }, OFFER_CLAIMANT, now, indexOf(await store.list()));
	if (!dry.ok) return refusal("offer", dry.error, card);

	let delivered: string[];
	try {
		delivered = (await dispatch.send({ kind: "event", to: "*", text: offerText(card, note) })).delivered;
	} catch (error) {
		return refusal("offer", formatOfferFailure(card, messageOf(error)), card);
	}
	const peers = await dispatch.peers().catch(() => undefined);
	const silent = notListening(peers, delivered);
	return textResult(formatOffer(card, delivered, silent), {
		action: "offer",
		card,
		delivered,
		...(silent.length === 0 ? {} : { notListening: silent }),
	});
}

/** `reclaim`: the owner clears and the card returns to To do, notes and all. */
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
	if (details.action === "offer") {
		const count = details.delivered?.length ?? 0;
		return `${cardRef(card.id)} offered to ${plural(count, "session")}`;
	}
	const who = details.assigned?.label ?? card.owner?.label;
	const target = details.action === "assign" && who !== undefined ? ` → ${who}` : "";
	return `${cardRef(card.id)} ${card.status}${target}`;
}
