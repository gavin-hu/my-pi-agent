/**
 * The `team` tool: the lead's round over the same cards `board` owns.
 *
 * Three actions, because they are the three that reach another session: hand a card out, offer
 * it, and ask a peer how its work is going. `assign` records the owner **first** and sends the
 * handoff **second**, and that order is the one that can be repaired: the peer reads a card that
 * already holds it, and a write no rule allowed sends nobody a message at all — where a message
 * for a card that then changed would have to describe the change to a peer that can no longer
 * act on it. A send that fails leaves the card owned with the handoff owed (`owesHandoff`), so a
 * repeat of the same verb is the retry rather than a second attempt at a first one. Either
 * failure is reported with the card as it actually is — including the one no rule refused, where
 * the store's own write threw — so the lead's next call starts from the truth. `ask` is the one
 * verb with no card behind it, and the one that names nothing the board can answer.
 *
 * A card's own state is `board`'s and only `board`'s: the claim that takes one, the reclaim that
 * gives one back, the lane moves, the contract, and the two signs. This tool reached two of them
 * once, as aliases of the same store operation with a second sentence and a second result line
 * each; #581 removed them, so the two doors cannot drift apart.
 *
 * All three verbs belong to a session the bus holds, so the gate is the first thing each asks: a
 * session on no team is offered no `team` tool by its entry, and a call that arrives anyway — the
 * turn a leave landed in, a record the heartbeat pruned — is refused with `NOT_ON_TEAM` before it
 * reads a card or sends anything. Past the gate, `assign` and `ask` still ask the bus to arm a
 * watch, because each is answered by mail and `session-bus` records a sender without arming one;
 * that call upgrades a member's watch and never joins a stranger, because a stranger has no tool.
 */

import type { ExtensionAPI, ExtensionContext, ExtensionToolContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import { attempt, messageOf } from "../../lib/errors.ts";
import { plural, sanitizeUntrustedLine } from "../../lib/format.ts";
import { sameLabel } from "../../lib/session-label.ts";
import {
	createDeliver,
	createTeamJoin,
	type Deliver,
	type DeliveryFailure,
	type TeamJoin,
} from "../../lib/session-tool.ts";
import { strayField } from "../../lib/stray-fields.ts";
import { type ToolFailure, textResult, toolError } from "../../lib/tool-result.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
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
import { type Card, type CardOwner, cardArg, cardRef, cardRefOf } from "../../lib/workflow/card.ts";
import type { TeamState } from "../../lib/workflow/join.ts";
import { indexOf } from "../../lib/workflow/links.ts";
import { type Actor, mayOp } from "../../lib/workflow/rules.ts";
import type { BoardSession } from "../../lib/workflow/session.ts";
import type { BoardStore } from "../../lib/workflow/store.ts";
import { askId, askText, DEFAULT_QUESTION, type ReplyRoute } from "./dispatch.ts";
import {
	formatAsk,
	formatBroadcast,
	formatHandoff,
	formatHandoffFailure,
	formatHandoffUnsent,
	formatNotSent,
	formatOffer,
	formatOfferFailure,
	formatOfferUnsent,
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

/** The steps both card verbs take, as `handover.ts` exports them, resolved on the first call. */
type Steps = typeof import("./handover.ts");

/** One refusal: the reason for the model, the state for the renderer. */
function refusal(action: TeamAction, message: string, card?: Card): ToolFailure<TeamDetails> {
	return toolError(message, { action, error: message, ...(card === undefined ? {} : { card }) });
}

/**
 * The call line's subject: the verb, the card, and the peer it names.
 *
 * `assign` and `ask` are the two verbs that act on a peer, and `ask` is the one with no
 * card — so its subject is the peer alone, and a line that stopped at the verb would hide
 * the only thing the call was about.
 */
function callSubject(action: TeamAction, args: Record<string, unknown>): string {
	const card = cardRefOf(args.card);
	const to = typeof args.to === "string" && args.to.trim() !== "" ? `${SEPARATORS.arrow}${args.to.trim()}` : "";
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
	deliver?: Deliver;
	/** Test seam: the join a verb makes, so a suite records it instead of asking a bus. */
	team?: TeamJoin;
}

/** The actions as the schema validates them. */
export function registerTools(pi: ExtensionAPI, session: BoardSession, deps: TeamToolsDeps = {}): void {
	const deliver = deps.deliver ?? createDeliver(pi);
	const team = deps.team ?? createTeamJoin(pi);
	// The steps the three verbs share, loaded on the first call that needs one: a session that only
	// renders a transcript never pays for them.
	let stepsModule: Promise<Steps> | undefined;
	const handover = (): Promise<Steps> => (stepsModule ??= import("./handover.ts"));

	/**
	 * Ask the bus to arm this member's watch, for the two verbs a peer answers by mail.
	 *
	 * A member whose record is armed and waking needs nothing here — the join returns the state it
	 * found — so the call is for the record that is armed without a wake, or one written by a build
	 * before the field existed. It never joins a stranger: the gate above answers first, and the
	 * tool that would have asked is not offered to a session on no team. Loaded on demand, so
	 * registration stays as small as it is.
	 *
	 * The answer is returned rather than only recorded, because a watch that did not arm is a
	 * message that must not go out: the peer could answer a session that never reads it.
	 */
	const upgradeWatch = async (ctx: ExtensionContext, label: string): Promise<TeamState> => {
		const { joinTeam } = await import("../../lib/workflow/join.ts");
		return await joinTeam(session, team, ctx, label);
	};

	pi.registerTool({
		name: TEAM_TOOL,
		label: "Team",
		// Offered only while this session is on the team: its entry syncs the active set from the
		// bus's record, and a registration that activated the tool would put it in every session.
		defaultActive: false,
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
			// The wildcard is the bus's broadcast and `offer` is the one verb that means it: `ask` sends the
			// `ask` kind and `assign` records one owner, so neither can carry `*` — and the bus refuses it
			// only after a join (`ask`) or after the owner is written (`assign`). Settled beside the
			// stray-field rule, which is what keeps a refused call from joining, writing, or sending.
			// Before `cardArg` deliberately: the argument is wrong whatever the card is, so
			// `assign card 999 to "*"` says this rather than `#999 does not exist`.
			const to = typeof args.to === "string" ? args.to.trim() : "";
			if (to === "*") return refusal(action, formatBroadcast(action));
			// Past the argument refusals, every branch below waits — on the store, on the bus, or on
			// the join — so the row says it is working from here rather than staying motionless.
			startToolProgress(onUpdate);
			// Reading the name fails like anything else can, and that failure is a refusal: a team
			// verb that throws is one the transcript cannot draw and the lead cannot read.
			const known = await attempt(session.who(ctx, ctx.cwd));
			if ("error" in known) return refusal(action, known.error);
			const me = known.value;
			// The gate, and the first thing a verb that reaches another session asks: a card's owner is
			// a name peers resolve, and a handoff or an offer from a session on no team reaches one a
			// peer cannot answer. Before the card argument and the store, so a refusal has read neither;
			// loaded here rather than at registration, so a session that never runs the round pays
			// nothing for it.
			const gate = await import("../../lib/workflow/join.ts");
			if (!(await gate.onTeam(session, ctx))) return refusal(action, gate.NOT_ON_TEAM);
			// The watch a peer's answer needs, built once per call from the name the reply line names —
			// so the round never keeps a second copy of its label.
			const join = (): Promise<TeamState> => upgradeWatch(ctx, me.label);
			try {
				const steps = await handover();
				// `ask` is the one verb with no card behind it, so it runs before the id and the store:
				// what it needs is this session's name, for the reply line, and the bus.
				if (action === "ask") return await askPeer(me, to, args.question, deliver, ctx, join, steps);
				const arg = cardArg(args.card);
				if ("error" in arg) return refusal(action, arg.error);
				const id = arg.id;
				const store = await session.store(ctx.cwd);
				const now = session.now();
				if (action === "offer") return await offerCard(store, me, id, args.note, now, deliver, ctx, steps);
				if (to === "") return refusal("assign", 'assign needs a peer: pass `to`, e.g. "billing-core".');
				return await assignCard(store, me, id, to, args.note, now, deliver, ctx, join, steps);
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
 * `assign`: check the preconditions, record the owner, then send the handoff.
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
	deliver: Deliver,
	ctx: ExtensionToolContext,
	join: () => Promise<TeamState>,
	steps: Steps,
): Promise<ReturnType<typeof textResult<TeamDetails>> | ToolFailure<TeamDetails>> {
	// Loaded where it is used: the team entry's registration budget may not grow for a verb.
	const { actorFor, ownerFor } = await import("../../lib/workflow/notice.ts");
	const card = await store.read(id);
	if (!card) return refusal("assign", `${cardRef(id)} does not exist.`);
	// A handoff to yourself is not a claim: it writes a message into your own inbox and
	// records you as the owner without the claim's next step. `claim` is that act.
	if (namesSelf(me, to))
		return refusal("assign", `${cardRef(id)} cannot be handed to yourself: \`claim\` takes one.`, card);
	// Who `to` names, asked once: a card records the id the bus gave its holder, and `holds` compares
	// ids first, so an id the caller typed is resolved to its peer rather than compared as a label.
	// The same read answers the quiet and not-listening lines, so the owner and the clauses describe
	// one roster — which is why it is read before the write rather than after the send.
	const reached = await deliver.peers(ctx).catch(() => undefined);
	const target = actorFor(reached, to);
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

	// State first: the owner and the handoff are written before anything is sent, so the peer reads
	// a card that already holds it. `told` is the delivery's to record, not this write's.
	const handoff = { at: now };
	const owner: CardOwner = target.id === undefined ? ownerFor(to, [], handoff) : { ...target, handoff };
	// Nothing was sent, so a write that threw or a rule refused is a handoff that never happened — the
	// card is the board's, and the result says so rather than naming a message that does not exist.
	const written = await steps.writeCard({
		store,
		id,
		op: { kind: "assign", to: owner },
		me,
		now,
		card,
		failure: (current, reason) => refusal("assign", formatHandoffFailure(current, to, reason), current),
	});
	if ("isError" in written) return written;

	// Then the sentence, keyed by the card's clock so a retry folds into a copy still waiting. The card
	// is the peer's and the message may not be out, which is what makes a repeat the retry.
	const sent = await steps.sendNotice({
		deliver,
		ctx,
		notice: "assign",
		card: written.card,
		address: target.id ?? target.label,
		context: { lead: store.config().lead, to, ...(note === undefined ? {} : { note }) },
		unsent: (current, reason) => refusal("assign", formatHandoffUnsent(current, to, reason), current),
	});
	if ("isError" in sent) return sent;
	// Settled only once the bus took it, and only because the row owns a `told` half — the record a
	// repeat reads, and the fact that no send can be a settled handoff.
	await steps.settleNotice(store, id, "assign", me, now);
	// Both lines read the roster the message was addressed against — the same read that named the
	// owner, so one result cannot describe two teams.
	const { silent, still } = steps.alarmLines(reached, sent.delivered);
	const current = await store.read(id).catch(() => undefined);
	const after = current ?? written.card;
	return textResult(formatHandoff(after, sent.delivered, silent, still, sent.failed), {
		action: "assign",
		card: after,
		assigned: after.owner,
		delivered: sent.delivered,
		...steps.alarmFields(silent, still, sent.failed),
	});
}

/**
 * `offer`: check the claim's preconditions, record the moment, then broadcast the card.
 *
 * State first, as `assign` writes the owner first: an offer recorded is one a lead can see nobody
 * took, and a broadcast that fails is an offer nobody heard rather than one never made — the same
 * trade, paid in the same direction, so the two verbs cannot disagree about which half survives.
 * What the record adds is the one thing an event cannot carry — when the offer was made — so a lead
 * can tell an offer nobody took from a card nobody has looked at.
 */
async function offerCard(
	store: BoardStore,
	me: Actor,
	id: string,
	note: string | undefined,
	now: number,
	deliver: Deliver,
	ctx: ExtensionToolContext,
	steps: Steps,
): Promise<ReturnType<typeof textResult<TeamDetails>> | ToolFailure<TeamDetails>> {
	const card = await store.read(id);
	if (!card) return refusal("offer", `${cardRef(id)} does not exist.`);
	// The board, not just the card: a card that waits on unfinished work, one somebody
	// holds, or a `plan` lane with no room is refused here, so a broadcast for it is never
	// sent. This is the offer's own rule, asked without the write.
	const refused = mayOp(card, { kind: "offer" }, me, indexOf(await store.list()), store.config());
	if (refused !== undefined) return refusal("offer", refused, card);

	// State first, as `assign`: the moment is recorded before the broadcast, and a broadcast that
	// fails is an offer nobody heard rather than an offer that was never made.
	const written = await steps.writeCard({
		store,
		id,
		op: { kind: "offer" },
		me,
		now,
		card,
		failure: (current, reason) => refusal("offer", formatOfferFailure(current, reason), current),
	});
	if ("isError" in written) return written;

	const sent = await steps.sendNotice({
		deliver,
		ctx,
		notice: "offer",
		card: written.card,
		address: "*",
		context: { lead: store.config().lead, ...(note === undefined ? {} : { note }) },
		unsent: (current, reason) => refusal("offer", formatOfferUnsent(current, reason), current),
	});
	if ("isError" in sent) return sent;
	// No settle, and that is the row's answer rather than this call's: `offer`'s notice owns no `told`
	// half, so there is nothing a repeat could re-send — `handover.ts` reads the table.
	const peers = await deliver.peers(ctx).catch(() => undefined);
	const { silent, still } = steps.alarmLines(peers, sent.delivered);
	return textResult(formatOffer(written.card, sent.delivered, silent, still, sent.failed), {
		action: "offer",
		card: written.card,
		delivered: sent.delivered,
		...steps.alarmFields(silent, still, sent.failed),
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
	to: string,
	rawQuestion: unknown,
	deliver: Deliver,
	ctx: ExtensionToolContext,
	join: () => Promise<TeamState>,
	steps: Steps,
): Promise<ReturnType<typeof textResult<TeamDetails>> | ToolFailure<TeamDetails>> {
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
	const peers = await deliver.peers(ctx).catch(() => undefined);
	const self = peers?.find((peer) => (me.id !== undefined ? peer.id === me.id : peer.label === me.label));
	const reply: ReplyRoute = self === undefined ? { to: me.label, byId: false } : { to: self.id, byId: true };
	const ask = askId();
	let delivered: string[];
	let failed: DeliveryFailure[];
	try {
		const sent = await deliver.send(ctx, { kind: "ask", to, text: askText(asked, ask, reply) });
		if (!sent.ok) return refusal("ask", `the ask did not reach ${to}: ${sent.error}`);
		delivered = sent.delivered;
		failed = sent.failed;
	} catch (error) {
		return refusal("ask", `the ask did not reach ${to}: ${messageOf(error)}`);
	}
	const { silent, still } = steps.alarmLines(peers, delivered);
	return textResult(formatAsk(ask, delivered, silent, still, failed), {
		action: "ask",
		askId: ask,
		delivered,
		...steps.alarmFields(silent, still, failed),
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
	const target = who === undefined ? "" : `${SEPARATORS.arrow}${who}`;
	return `${cardRef(card.id)} ${card.lane}${target}`;
}
