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
import { type Actor, applyOp } from "../../lib/board/rules.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import type { BoardStore } from "../../lib/board/store.ts";
import { messageOf } from "../../lib/errors.ts";
import { failedResult, type ToolFailure, textResult } from "../../lib/tool-result.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { callLine, detailsOrLine } from "../../lib/tui/tool.ts";
import { type Dispatch, handoffText, ownerFor, sessionDispatch } from "./dispatch.ts";
import { formatHandoff, formatHandoffFailure, formatRacedAssignment, formatReclaimed } from "./format.ts";
import { TeamParams } from "./schema.ts";
import { normalizeTeamAction, TEAM_ACTIONS, TEAM_TOOL, type TeamAction, type TeamDetails } from "./types.ts";

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
			"(`to` is a live session's label or id, as `session status` lists them), and `reclaim` takes a card back to To do. " +
			"Only `assign` and `reclaim` need the session bus; use `board` for everything else. Dispatch cannot start a peer's " +
			"turn: the handoff waits in its inbox, and an armed `session watch` is what raises it.",
		promptSnippet: "Run a round over the board: assign a card to a running session, or reclaim one.",
		promptGuidelines: [
			"Find live peers with the `session` tool before assigning; a label that is not live cannot be handed a card.",
			"A peer must have armed `session watch` for a handoff to raise its turn — say so when a handoff matters.",
			"Reclaim a card whose owner has gone quiet rather than editing someone else's work.",
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
			const id = normalizeCardId(args.card);
			if (id === undefined) return refusal(action, `"${String(args.card)}" is not a card id.`);
			const me = session.who(ctx, ctx.cwd);
			try {
				const store = await session.store(ctx.cwd);
				const now = session.now();
				if (action === "reclaim") return await reclaimCard(store, me, id, now);
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
	const dry = applyOp(card, { kind: "assign", to: owner }, me, now);
	if (!dry.ok) return refusal("assign", dry.error, card);

	let delivered: string[];
	try {
		delivered = (await dispatch.send(to, handoffText(card, to, note))).delivered;
	} catch (error) {
		return refusal("assign", formatHandoffFailure(card, to, messageOf(error)), card);
	}

	// Ask the bus for the session behind the label: an owner recorded with its id
	// survives the peer renaming itself, which a label alone does not.
	const resolved = await dispatch.resolve?.(to).catch(() => undefined);
	const applied = await store.mutate(id, { kind: "assign", to: resolved ?? ownerFor(to, delivered) }, me, now);
	if (!applied.ok)
		return refusal("assign", formatRacedAssignment(applied.card ?? card, to, applied.error), applied.card ?? card);
	return textResult(formatHandoff(applied.card, to, delivered), {
		action: "assign",
		card: applied.card,
		assigned: applied.card.owner,
		delivered,
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
	const who = details.assigned?.label ?? card.owner?.label;
	const target = details.action === "assign" && who !== undefined ? ` → ${who}` : "";
	return `${cardRef(card.id)} ${card.status}${target}`;
}
