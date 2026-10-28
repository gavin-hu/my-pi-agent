/**
 * The `session` tool, as the extensions that are not `session-bus` call it.
 *
 * `board` and `team` are the user's surface for the team; the bus is the transport
 * underneath, and neither may import it (`test/structure.test.ts`). So the one place
 * that turns a call into a typed answer lives here, next to the tool's name in
 * `lib/tool-names.ts` — two copies would be two copies of the details-shape
 * knowledge, and a bus that renamed a field would be broken in one of them.
 *
 * There are two transports, and the difference is the context, not the caller's
 * choice: `join` travels as an in-process request on `pi.events` because a *command*
 * context has no `ctx.executeTool` — the same constraint `lib/plan-entry.ts` exists
 * for — while `peers` and `send` are nested tool calls, which only ever run inside a
 * tool. One function either way, so a caller never has to know which it is holding.
 *
 * Every function returns a result and none throws: "the bus is not loaded", "a plan
 * is open", and "that label is taken" are all answers a caller reports, not reasons
 * to abandon a board write or a card operation that has nothing to do with the bus.
 *
 * This module is the *caller* side only. Reading the bus's records from disk is
 * `session-roster.ts`, which is what works when the bus is not loaded at all.
 */

import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { type BusAnswer, requestOverBus } from "./bus-request.ts";
import { messageOf } from "./errors.ts";
import { watchingOf } from "./session-roster.ts";
import { SESSION_TOOL } from "./tool-names.ts";

/**
 * The `session send` text limit, which is also the longest handoff or offer.
 *
 * It is copied from the bus's protocol rather than imported — the dependency runs one
 * way — and it lives here so `team` and `board` clip to one number instead of two.
 */
export const MAX_MESSAGE_TEXT = 4_000;

/** Whether a session is listening for mail, and whether it raises a turn. */
export interface Watching {
	armed: boolean;
	wake: boolean;
}

/** One session the bus lists. */
export interface Peer {
	id: string;
	label: string;
	/** Absent when the record does not say, which is not the same as "not listening". */
	listening?: boolean;
}

/** What a join did: the label it landed on, and whether mail will reach the session. */
export type JoinResult = { ok: true; label: string; watching: Watching } | { ok: false; error: string };

/** EventBus channel on which a caller asks `session-bus` to join the team for it. */
export const TEAM_JOIN_REQUEST = "my-pi-agent/team-join/request";

/**
 * What a join asks for.
 *
 * `label` is the name to be on the team as; without one the bus settles its own. `name`
 * is the separate question of whether that label also becomes Pi's session name — the
 * footer and `/resume` — and it is opt-in, because a join is not a rename: only
 * `/team join <label>` means "call me this from now on".
 */
export interface TeamJoinInput {
	label?: string;
	wake?: boolean;
	listen?: boolean;
	name?: boolean;
}

/** What a caller sends on {@link TEAM_JOIN_REQUEST}. */
export interface TeamJoinRequest {
	/** The caller's context; the bus starts and names through it. */
	ctx: ExtensionContext;
	/** What to join as and how to listen. */
	input: TeamJoinInput;
	/** Claimed once, with what the bus answered; the caller settles on that claim. */
	respond(result: BusAnswer<JoinResult>): void;
}

/** What a send did. */
export type SendResult = { ok: true; delivered: string[] } | { ok: false; error: string };

/** One nested call's answer: the details on success, the sentence on failure. */
type Answer = { details: Record<string, unknown> } | { error: string };

/**
 * Call the `session` tool once.
 *
 * A nested call reports failure in its result rather than by rejecting; a rejection
 * is still caught, because a bus that is not registered at all throws before the
 * tool runs and the caller deserves the sentence rather than an exception.
 */
async function call(ctx: ExtensionToolContext, args: Record<string, unknown>): Promise<Answer> {
	const outcome = await ctx.executeTool(SESSION_TOOL, args).catch((error: unknown) => ({
		isError: true as const,
		result: { content: [{ type: "text", text: messageOf(error) }], details: undefined },
	}));
	if (outcome.isError) return { error: nestedMessage(outcome.result) };
	const details = outcome.result.details;
	return { details: typeof details === "object" && details !== null ? (details as Record<string, unknown>) : {} };
}

/** The message a failed nested call carries, or a sentence that says only that it failed. */
function nestedMessage(result: { content?: Array<{ type: string; text?: string }> } | undefined): string {
	const text = result?.content?.find((block) => block.type === "text")?.text;
	return text !== undefined && text !== "" ? text.replace(/^Error:\s*/, "") : "the session bus did not answer.";
}

/**
 * How an extension joins the team, whatever kind of context it is holding.
 *
 * Two extensions ask — `board` when the page opens or a card is claimed, `team` for
 * `/team join` — and both hold a command or a tool context, so the request is the one
 * transport that works from either.
 */
export interface TeamJoin {
	/** Join the team as `input.label` when given. Never throws. */
	join(ctx: ExtensionContext, input?: TeamJoinInput): Promise<JoinResult>;
}

/** The production join, bound to one extension's `pi`. */
export function createTeamJoin(pi: Pick<ExtensionAPI, "events" | "getAllTools">): TeamJoin {
	return {
		join: (ctx, input) => join(pi, ctx, input ?? {}),
	};
}

/** What a caller is told when there is no bus to join: one sentence on both paths. */
const NO_BUS = "the session bus is not loaded";

/**
 * Join the team: on the bus, named when a label is given, and listening for mail.
 *
 * One call for all three, because that is one act — see `join` in
 * `extensions/session-bus` — and one transport for both kinds of caller: the request
 * travels on `pi.events` and the bus answers it. Pi's session name is not one of the
 * three: that is `input.name`, which only a caller meaning to rename asks for.
 *
 * With no bus loaded there is no listener, so the answer is the sentence the caller
 * reports rather than a promise that never settles: the `session` tool's presence is
 * checked here, and the shared handshake refuses the same way if a bus is loaded but
 * listening for nothing.
 */
export async function join(
	pi: Pick<ExtensionAPI, "events" | "getAllTools">,
	ctx: ExtensionContext,
	input: TeamJoinInput = {},
): Promise<JoinResult> {
	if (!pi.getAllTools().some((tool) => tool.name === SESSION_TOOL)) return { ok: false, error: NO_BUS };
	return requestOverBus<JoinResult, TeamJoinRequest>(pi, {
		channel: TEAM_JOIN_REQUEST,
		payload: (respond) => ({ ctx, input, respond }),
		unclaimed: () => ({ ok: false, error: NO_BUS }),
		failed: (error) => ({ ok: false, error: messageOf(error) }),
	});
}

/**
 * Every session the bus lists, or `undefined` when it cannot answer.
 *
 * Named `listPeers` rather than `peers` so it cannot be mistaken for a caller's own
 * formatting helper — `wechat`'s doctor has one — and a caller reads the verb.
 *
 * A caller renders "the record does not say" differently from "nobody is here", so a
 * failed read is not an empty list.
 */
export async function listPeers(ctx: ExtensionToolContext): Promise<Peer[] | undefined> {
	const answer = await call(ctx, { action: "status" });
	if ("error" in answer) return undefined;
	const status = answer.details.status;
	if (typeof status !== "object" || status === null) return undefined;
	const sessions = (status as { sessions?: unknown }).sessions;
	if (!Array.isArray(sessions)) return undefined;
	const peers: Peer[] = [];
	for (const entry of sessions) {
		if (typeof entry !== "object" || entry === null) continue;
		const { id, label, watching } = entry as Record<string, unknown>;
		if (typeof id !== "string" || typeof label !== "string") continue;
		const state = watchingOf(watching);
		peers.push({ id, label, ...(state === undefined ? {} : { listening: state.armed }) });
	}
	return peers;
}

/** Send one message, and report the labels a message file was written for. */
export async function send(
	ctx: ExtensionToolContext,
	input: { kind: "handoff" | "event"; to: string; text: string },
): Promise<SendResult> {
	const answer = await call(ctx, { action: "send", kind: input.kind, to: input.to, text: input.text });
	if ("error" in answer) return { ok: false, error: answer.error };
	const delivered = answer.details.delivered;
	return {
		ok: true,
		delivered: Array.isArray(delivered) ? delivered.filter((label): label is string => typeof label === "string") : [],
	};
}
