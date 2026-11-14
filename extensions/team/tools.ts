/**
 * The `team` tool: the lead's round over the same cards `board` owns.
 *
 * Three actions, because they are the three that reach another session: hand a card out, offer
 * it, and ask a peer how its work is going. `assign` sends the handoff **first** and sets the
 * owner **second**: a card assigned without a message is a card nobody knows about, while a
 * message for a card that then changed is one the peer can still claim. Either failure is
 * reported with the card as it actually is — including the one no rule refused, where the
 * store's own write threw after the message had landed — so the lead's next call starts from
 * the truth. `ask` is the one verb with no card behind it, and the one that names nothing the
 * board can answer.
 *
 * A card's own state is `board`'s and only `board`'s: the claim that takes one, the reclaim that
 * gives one back, the lane moves, the contract, and the two signs. This tool reached two of them
 * once, as aliases of the same store operation with a second sentence and a second result line
 * each; #581 removed them, so the two doors cannot drift apart.
 *
 * `assign` and `ask` join this session to the team once, because each is answered by mail:
 * `session-bus` records a sender and arms no watch, so without the join a lead that only ever runs
 * the round would have a reply nobody reports. Both join **before** they send, because the message
 * names this session as the way back — a lead the bus will not hold hands a peer a reply its own
 * `session send` refuses — and they send nothing when the join does not land. `offer` does not
 * join, and need not: it is answered by a claim.
 */

import type { ExtensionAPI, ExtensionContext, ExtensionToolContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import { type Card, type CardOwner, cardRef, normalizeCardId } from "../../lib/board/card.ts";
import type { TeamState } from "../../lib/board/join.ts";
import { indexOf } from "../../lib/board/links.ts";
import { type Actor, mayOp } from "../../lib/board/rules.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import type { BoardStore, MutateResult } from "../../lib/board/store.ts";
import { messageOf } from "../../lib/errors.ts";
import { sanitizeUntrustedLine } from "../../lib/format.ts";
import { sameLabel } from "../../lib/session-label.ts";
import { createTeamJoin, type DeliveryFailure, type TeamJoin } from "../../lib/session-tool.ts";
import { failedResult, type ToolFailure, textResult } from "../../lib/tool-result.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { paint } from "../../lib/tui/tokens.ts";
import {
	callLine,
	detailsOrLine,
	elapsedSuffix,
	messageText,
	startToolProgress,
	syncElapsedTimer,
	type ToolMessageResult,
} from "../../lib/tui/tool.ts";
import { plural } from "../../lib/board/round-text.ts";
import { strayField } from "../../lib/stray-fields.ts";
import {
	actorFor,
	askId,
	askText,
	type Dispatch,
	DEFAULT_QUESTION,
	handoffText,
	notListening,
	offerText,
	quiet,
	type ReplyRoute,
	ownerFor,
	sessionDispatch,
} from "./dispatch.ts";
import {
	formatAsk,
	formatHandoff,
	formatHandoffFailure,
	formatNotSent,
	formatOffer,
	formatOfferFailure,
	formatRacedOffer,
	formatRacedAssignment,
	formatUnrecordedAssignment,
	formatUnrecordedOffer,
	formatWorking,
} from "./format.ts";
import { TeamParams } from "./schema.ts";
import {
	ACTION_FIELDS,
	normalizeTeamAction,
	TEAM_ACTIONS,
	TEAM_DESCRIPTION,
	TEAM_GUIDELINES,
	TEAM_SNIPPET,
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

/** One store write, keeping a throw rather than throwing it: the caller owns the half-applied case. */
async function writeOutcome(write: Promise<MutateResult>): Promise<{ result: MutateResult } | { thrown: unknown }> {
	try {
		return { result: await write };
	} catch (thrown) {
		return { thrown };
	}
}

/**
 * One half-applied round: the message landed and the write after it threw.
 *
 * The one failure a refusal cannot describe, because the card is not the card it was: the
 * store threw somewhere inside the write, so what it now holds is read rather than assumed,
 * and a store that will not read either leaves the card the message was written from. The
 * peers the message reached travel with it, because they are the reason the lead cannot
 * simply try again and pretend nothing was sent.
 */
async function unrecordedResult(
	action: TeamAction,
	store: BoardStore,
	card: Card,
	text: string,
	delivered: readonly string[],
): Promise<ToolFailure<TeamDetails>> {
	const current = await store.read(card.id).catch(() => undefined);
	return failedResult(`Error: ${text}`, {
		action,
		error: text,
		card: current ?? card,
		delivered: [...delivered],
	});
}

/**
 * The call line's subject: the verb, the card, and the peer it names.
 *
 * `assign` and `ask` are the two verbs that act on a peer, and `ask` is the one with no
 * card — so its subject is the peer alone, and a line that stopped at the verb would hide
 * the only thing the call was about.
 */
function callSubject(action: TeamAction, args: Record<string, unknown>): string {
	const card = typeof args.card === "string" && args.card.trim() !== "" ? cardRef(args.card.trim()) : "";
	const to = typeof args.to === "string" && args.to.trim() !== "" ? ` → ${args.to.trim()}` : "";
	const peer = action === "assign" || action === "ask" ? to : "";
	return card === "" ? `${action}${peer}` : `${action} ${card}${peer}`;
}

/**
 * The result's own lines, as the expanded block draws them.
 *
 * `format.ts` owns the wording, and the model reads it as the call's text, so the block
 * draws that text rather than a second copy of the sentences: a card's title and paths
 * reach a human in the words the tool already wrote. Both are a card's, so every line is
 * sanitized at the boundary before the theme paints it — and the indent `format.ts` gives
 * a continuation line is put back, because the sanitizer trims one and a title under the
 * sentence it belongs to is not a list item.
 */
function resultLines(theme: Theme, result: ToolMessageResult): string {
	return messageText(result)
		.split("\n")
		.map((line) => paint(theme, "toolOutput", `${continuationIndent(line)}${sanitizeUntrustedLine(line)}`))
		.join("\n");
}

/** The two-space indent a result's continuation line carries, and a first line does not. */
function continuationIndent(line: string): string {
	return line.startsWith("  ") ? "  " : "";
}

/** What the tool needs from the outside, so a suite drives it without a bus. */
export interface TeamToolsDeps {
	/** Test seam: the handoff transport. */
	dispatch?: (ctx: ExtensionToolContext) => Dispatch;
	/** Test seam: the join a verb makes, so a suite records it instead of asking a bus. */
	team?: TeamJoin;
}

/** The actions as the schema validates them. */
export function registerTools(pi: ExtensionAPI, session: BoardSession, deps: TeamToolsDeps = {}): void {
	const dispatchFor = deps.dispatch ?? ((ctx: ExtensionToolContext) => sessionDispatch(pi, ctx));
	const team = deps.team ?? createTeamJoin(pi);

	/**
	 * Put this session on the team, once, for the verbs a peer answers by mail.
	 *
	 * The same join `/board` and `board`'s claim make, asked again when the bus no longer holds
	 * this session, so a lead that only ever runs the round is on the team under the label it
	 * writes cards as rather than merely on the bus, where a send records a sender and arms no
	 * watch. Loaded on demand, like the claim's join was, so registration stays as small as it is.
	 *
	 * The answer is returned rather than only recorded, because two of the three verbs send a
	 * message the answer is the precondition of: a join that did not land is a message that must
	 * not go out, and one that did is why the peer can answer at all.
	 */
	const joinRound = async (ctx: ExtensionContext, label: string): Promise<TeamState> => {
		const { joinTeam } = await import("../../lib/board/join.ts");
		return await joinTeam(session, team, ctx, label);
	};

	pi.registerTool({
		name: TEAM_TOOL,
		label: "Team",
		description: TEAM_DESCRIPTION,
		promptSnippet: TEAM_SNIPPET,
		promptGuidelines: TEAM_GUIDELINES,
		parameters: TeamParams,
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const args = params as TeamArgs;
			const action = normalizeTeamAction(args.action);
			if (!action) {
				return refusal("assign", `unknown action "${String(args.action)}"; use ${TEAM_ACTIONS.join(" or ")}.`);
			}
			// Before the store and before the card: a refused call has done nothing, so it
			// cannot have read a card or sent a message on its way to the refusal.
			const stray = strayField(action, args, ACTION_FIELDS);
			if (stray !== undefined) return refusal(action, stray);
			// Past the argument refusals, every branch below waits — on the store, on the bus, or on
			// the join — so the row says it is working from here rather than staying motionless.
			startToolProgress(onUpdate);
			// Reading the name fails like anything else can, and that failure is a refusal: a team
			// verb that throws is one the transcript cannot draw and the lead cannot read.
			const actor = await session.who(ctx, ctx.cwd).then(
				(known) => known,
				(error: unknown) => messageOf(error),
			);
			if (typeof actor === "string") return refusal(action, actor);
			const me = actor;
			// The join every verb a peer answers by mail asks for, built once per call from the
			// name the reply line names — so the round never keeps a second copy of its label.
			const join = (): Promise<TeamState> => joinRound(ctx, me.label);
			try {
				// `ask` is the one verb with no card behind it, so it runs before the id and the store:
				// what it needs is this session's name, for the reply line, and the bus.
				if (action === "ask") return await askPeer(me, args.to, args.question, dispatchFor(ctx), join);
				const id = args.card === undefined ? undefined : normalizeCardId(args.card);
				if (id === undefined) {
					return refusal(
						action,
						args.card === undefined
							? 'card is required: pass the id, e.g. "4".'
							: `"${String(args.card)}" is not a card id.`,
					);
				}
				const store = await session.store(ctx.cwd);
				const now = session.now();
				if (action === "offer") return await offerCard(store, me, id, args.note, now, dispatchFor(ctx));
				const to = typeof args.to === "string" ? args.to.trim() : "";
				if (to === "") return refusal("assign", 'assign needs a peer: pass `to`, e.g. "billing-core".');
				return await assignCard(store, me, id, to, args.note, now, dispatchFor(ctx), join);
			} catch (error) {
				return refusal(action, messageOf(error));
			}
		},

		renderCall(args, theme, context) {
			const action = normalizeTeamAction(args.action) ?? "assign";
			return callLine(theme, context.lastComponent, TEAM_TOOL, callSubject(action, args as Record<string, unknown>));
		},

		renderResult(result, options, theme, context) {
			const startedAt = syncElapsedTimer(options.isPartial, context);
			const text = reuseText(context?.lastComponent);
			// A partial result carries no details, so the live line comes before `detailsOrLine`,
			// which would otherwise read the working frame as a rejection.
			if (options.isPartial) {
				const verb = normalizeTeamAction((context.args as { action?: unknown } | undefined)?.action) ?? "assign";
				const elapsed = startedAt === undefined ? "" : elapsedSuffix(theme, Date.now() - startedAt);
				text.setText(paint(theme, "warn", formatWorking(verb)) + elapsed);
				return text;
			}
			const details = toolDetails<TeamDetails>(result.details);
			const outcome = detailsOrLine(theme, result, options.expanded, details);
			if ("line" in outcome) {
				text.setText(outcome.line);
				return text;
			}
			// A round's result is a card and a sentence about it, so the collapsed block is the one
			// summary line and expanding reveals the lines the model was handed. The duration rides the
			// summary: the model's own sentences are not the place for a column of time.
			text.setText(
				options.expanded
					? resultLines(theme, result)
					: summaryOf(outcome.details) + elapsedSuffix(theme, context.durationMs),
			);
			return text;
		},
	});
}

/**
 * `assign`: check the preconditions, send the handoff, then set the owner.
 *
 * The preconditions are checked with `mayOp`, the same decision the store's `applyOp` will
 * make — and with the store's own limits, so a configured WIP cap is the one the precheck
 * sees — so an assignment the rules would refuse never sends a message at all. The join comes
 * before the message, and is the last precondition: the handoff names this session as the one
 * the peer asks for its two gates, so a session the bus will not hold would send a peer to a
 * reply that is refused. A refused join therefore sends nothing, and the card is untouched.
 */
async function assignCard(
	store: BoardStore,
	me: Actor,
	id: string,
	to: string,
	note: string | undefined,
	now: number,
	dispatch: Dispatch,
	join: () => Promise<TeamState>,
): Promise<ReturnType<typeof textResult<TeamDetails>> | ToolFailure<TeamDetails>> {
	const card = await store.read(id);
	if (!card) return refusal("assign", `${cardRef(id)} does not exist.`);
	// A handoff to yourself is not a claim: it writes a message into your own inbox and
	// records you as the owner without the claim's next step. `claim` is that act.
	if (namesSelf(me, to))
		return refusal("assign", `${cardRef(id)} cannot be handed to yourself: \`claim\` takes one.`, card);
	// Who `to` names, asked before the check: a card records the id the bus gave its holder, and `holds`
	// compares ids first, so an id the caller typed is resolved to its peer rather than compared as a
	// label. This read is the dry run's alone — the write records what a read taken *after* the
	// message says, because the send answers labels and the card must name the session that has it.
	const target = actorFor(await dispatch.peers().catch(() => undefined), to);
	// The board, not just the card: a card that waits on unfinished work, or a `plan` lane
	// with no room, is refused here, so a handoff for it is never sent. `mayOp` is the
	// store's own check without the write, and the board's settings are the store's, not a default.
	const refused = mayOp(card, { kind: "assign", to: target }, me, indexOf(await store.list()), store.config());
	if (refused !== undefined) return refusal("assign", refused, card);
	// After the rule and before the message: a refusal above still enlists nobody, and this one
	// has to be answered before anything reaches the peer.
	const joined = await join();
	if ("error" in joined) {
		return refusal("assign", formatNotSent(`${cardRef(card.id)} was not handed off to ${to}`, joined), card);
	}

	let delivered: string[];
	let failed: DeliveryFailure[];
	try {
		const sent = await dispatch.send({ kind: "handoff", to, text: handoffText(card, to, store.config().lead, note) });
		delivered = sent.delivered;
		failed = sent.failed;
	} catch (error) {
		return refusal("assign", formatHandoffFailure(card, to, messageOf(error)), card);
	}

	// The owner: the peer the message reached, read now rather than kept from the dry run — a roster
	// that changed mid-send would otherwise pass a check about one session and write another. The store
	// re-asks the card's own gates under the lock, which stops a mid-send handover from assigning a card
	// somebody took; who the peer is has no second reading, which is the reason for this one.
	// `told` is the send's own answer, and a send that returned wrote at least one inbox (`SendResult`),
	// so the record always carries it — a handoff without one is a card from before the field existed.
	const reached = await dispatch.peers().catch(() => undefined);
	const recipient = actorFor(reached, to);
	const handoff = { at: now, told: { at: now } };
	const owner: CardOwner = recipient.id === undefined ? ownerFor(to, delivered, handoff) : { ...recipient, handoff };
	const written = await writeOutcome(store.mutate(id, { kind: "assign", to: owner }, me, now));
	// A write that threw is not a write that was refused: the message is already in the peer's
	// inbox, so the reason is reported with the card the board holds now rather than alone.
	if ("thrown" in written)
		return await unrecordedResult(
			"assign",
			store,
			card,
			formatUnrecordedAssignment(card, to, messageOf(written.thrown)),
			delivered,
		);
	const applied = written.result;
	if (!applied.ok)
		return refusal("assign", formatRacedAssignment(applied.card ?? card, to, applied.error), applied.card ?? card);
	// Both lines read that same post-send roster: the card, the quiet line and the not-listening line
	// describe the team the message landed against, not the one it was addressed against.
	const silent = notListening(reached, delivered);
	const still = quiet(reached, delivered);
	return textResult(formatHandoff(applied.card, delivered, silent, still, failed), {
		action: "assign",
		card: applied.card,
		assigned: applied.card.owner,
		delivered,
		...(failed.length === 0 ? {} : { failed }),
		...(silent.length === 0 ? {} : { notListening: silent }),
		...(still.length === 0 ? {} : { quiet: still }),
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
	let failed: DeliveryFailure[];
	try {
		const sent = await dispatch.send({ kind: "event", to: "*", text: offerText(card, store.config().lead, note) });
		delivered = sent.delivered;
		failed = sent.failed;
	} catch (error) {
		return refusal("offer", formatOfferFailure(card, messageOf(error)), card);
	}
	// The peers have the event, so a card that changed underneath is reported as raced
	// rather than refused: the message is already in their inboxes. The same holds for the
	// peer the broadcast missed — the offer is recorded, and the result names who did not hear.
	const written = await writeOutcome(store.mutate(id, { kind: "offer" }, me, now));
	// The peers have the event, so a write that threw is reported as an offer that landed and
	// a record that did not: a bare reason read as "nothing happened", and a retry broadcast it
	// again.
	if ("thrown" in written)
		return await unrecordedResult(
			"offer",
			store,
			card,
			formatUnrecordedOffer(card, messageOf(written.thrown)),
			delivered,
		);
	const recorded = written.result;
	if (!recorded.ok) return refusal("offer", formatRacedOffer(recorded.card ?? card, recorded.error), recorded.card);
	const peers = await dispatch.peers().catch(() => undefined);
	const silent = notListening(peers, delivered);
	const still = quiet(peers, delivered);
	return textResult(formatOffer(recorded.card, delivered, silent, still, failed), {
		action: "offer",
		card: recorded.card,
		delivered,
		...(failed.length === 0 ? {} : { failed }),
		...(silent.length === 0 ? {} : { notListening: silent }),
		...(still.length === 0 ? {} : { quiet: still }),
	});
}

/** Whether `to` names this session: its id, or its label ignoring case. */
function namesSelf(me: Actor, to: string): boolean {
	const target = to.trim();
	return (me.id !== undefined && target === me.id) || sameLabel(target, me.label);
}

/**
 * `ask`: send one peer a question, and report what happened to it.
 *
 * The one verb that writes no card: there is nothing to check, nothing to own, and nothing
 * to wait on. What it does report is the same pair `assign` does — the labels a message file
 * was written for, and which of them will read it at their next turn instead of being
 * woken — because "delivered" and "delivered and read" are different answers to a lead
 * asking whether a peer heard.
 */
async function askPeer(
	me: Actor,
	rawTo: unknown,
	rawQuestion: unknown,
	dispatch: Dispatch,
	join: () => Promise<TeamState>,
): Promise<ReturnType<typeof textResult<TeamDetails>> | ToolFailure<TeamDetails>> {
	const to = typeof rawTo === "string" ? rawTo.trim() : "";
	if (to === "") return refusal("ask", 'ask needs a peer: pass `to`, e.g. "billing-core".');
	// The same rule `assign` applies to a card: a question to yourself is mail you already
	// read, and the round is the better answer to it.
	if (namesSelf(me, to)) return refusal("ask", `${to} is this session — the round already says what you hold.`);
	const asked = typeof rawQuestion === "string" && rawQuestion.trim() !== "" ? rawQuestion.trim() : DEFAULT_QUESTION;
	// Before the message, for `assign`'s reason: the answer comes back to the name `askText` just
	// named, so that name has to be on the bus before the peer reads it.
	const joined = await join();
	if ("error" in joined) return refusal("ask", formatNotSent(`the ask did not reach ${to}`, joined));
	// The reply route is this session's own id, read from the roster the join just wrote: an id
	// survives this session renaming itself and its record being pruned, and the label is the
	// fallback the sentence then admits to. One read serves the delivery warnings below too.
	const peers = await dispatch.peers().catch(() => undefined);
	const self = peers?.find((peer) => (me.id !== undefined ? peer.id === me.id : peer.label === me.label));
	const reply: ReplyRoute = self === undefined ? { to: me.label, byId: false } : { to: self.id, byId: true };
	const ask = askId();
	let delivered: string[];
	let failed: DeliveryFailure[];
	try {
		const sent = await dispatch.send({ kind: "ask", to, text: askText(asked, ask, reply) });
		delivered = sent.delivered;
		failed = sent.failed;
	} catch (error) {
		return refusal("ask", `the ask did not reach ${to}: ${messageOf(error)}`);
	}
	const silent = notListening(peers, delivered);
	const still = quiet(peers, delivered);
	return textResult(formatAsk(ask, delivered, silent, still, failed), {
		action: "ask",
		askId: ask,
		delivered,
		...(failed.length === 0 ? {} : { failed }),
		...(silent.length === 0 ? {} : { notListening: silent }),
		...(still.length === 0 ? {} : { quiet: still }),
	});
}

/** The collapsed line for a successful call, from its details. */
function summaryOf(details: TeamDetails): string {
	if (details.action === "ask") return `asked ${details.delivered?.join(", ") ?? "nobody"}`;
	const card = details.card;
	// A refusal is drawn from its error, so a result reaching here wrote a card: the guard is for
	// the shape rather than for a case a call can produce.
	if (!card) return "handed off";
	if (details.action === "offer") {
		const count = details.delivered?.length ?? 0;
		return `${cardRef(card.id)} offered to ${plural(count, "session")}`;
	}
	const who = details.assigned?.label ?? card.owner?.label;
	const target = who === undefined ? "" : ` → ${who}`;
	return `${cardRef(card.id)} ${card.lane}${target}`;
}
