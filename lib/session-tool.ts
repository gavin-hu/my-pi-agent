/**
 * The `session` tool, as the extensions that are not `session-bus` call it.
 *
 * `board` and `team` are the user's surface for the team; the bus is the transport
 * underneath, and neither may import it (`test/boundaries.test.ts`). So the one place
 * that turns a call into a typed answer lives here, next to the tool's name in
 * `lib/tool-names.ts` — two copies would be two copies of the details-shape
 * knowledge, and a bus that renamed a field would be broken in one of them.
 *
 * There are two transports, and the difference is the context, not the caller's
 * choice: `join` travels as an in-process request on `pi.events` because a *command*
 * context has no `ctx.executeTool` — the same constraint `lib/plan-entry.ts` exists
 * for — `peers` is a nested tool call, and `send` is whichever its context allows: the
 * nested call from a tool, where the bus's own validation and hooks run, and the same
 * request from a command, so `/board approve` can tell a card's owner its gate was
 * signed. A path claim and a release are the same pair, and their second transport is
 * `before_agent_start`'s: a board re-claims a resumed session's paths from an event
 * handler, which has no nested call either. One function either way, so a caller never
 * has to know which it is holding.
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
import { sanitizeLine } from "./format.ts";
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

/**
 * One recipient a message could not be written for.
 *
 * A send is one file per inbox, so a failure part-way through a broadcast leaves the peers
 * written before it holding the message. What a caller is told is therefore two lists.
 */
export interface DeliveryFailure {
	label: string;
	error: string;
}

/**
 * The one sentence for the peers a message did not reach.
 *
 * `session send` and the three `team` verbs print it, so it lives here: two copies are how
 * a label one of them forgot to sanitize reaches a rendered frame.
 */
export function notDeliveredLine(failed: readonly DeliveryFailure[]): string | undefined {
	if (failed.length === 0) return undefined;
	const who = failed.map((entry) => `${sanitizeLine(entry.label)} (${sanitizeLine(entry.error)})`).join(", ");
	return `Not delivered to ${who}.`;
}

/** EventBus channel on which a caller asks `session-bus` to join the team for it. */
export const TEAM_JOIN_REQUEST = "my-pi-agent/team-join/request";

/** EventBus channel on which a caller asks `session-bus` to send its message for it. */
export const SESSION_SEND_REQUEST = "my-pi-agent/session-send/request";

/**
 * What a join asks for.
 *
 * `label` is the name to be on the team as; without one the bus settles its own. `name`
 * is the separate question of whether that label also becomes Pi's session name — what
 * `/resume` lists — and it is opt-in, because a join is not a rename: only
 * `/team join <label>` means "call me this from now on". The footer needs no opt-in: it
 * draws the label itself, so a plain join moves what the bar names this session.
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

/**
 * What a send did.
 *
 * `ok` is the bus's own answer to "did anyone get this": a total failure is `ok: false`,
 * because no recipient can be told a message landed. A partial one is a success carrying
 * the peers a file could not be written for, which is the only case that needs saying.
 */
export type SendResult = { ok: true; delivered: string[]; failed: DeliveryFailure[] } | { ok: false; error: string };

/** One message to send: its kind, who to, and the text. */
export interface SendInput {
	kind: "handoff" | "event" | "ask";
	to: string;
	text: string;
}

/**
 * What a send asks of the bus when the caller holds a context with no `executeTool`.
 *
 * The bus starts through this context, so a command's send is the tool's send with one hop
 * in between, and the answer is the same {@link SendResult} either way.
 */
export interface SessionSendRequest {
	ctx: ExtensionContext;
	input: SendInput;
	respond(result: BusAnswer<SendResult>): void;
}

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
 * Whether the `session` tool is loaded at all.
 *
 * The difference a caller acts on: no bus is a sentence a board still works through, while a
 * bus that refused is a failure worth reporting. One probe, so the three callers that ask it
 * cannot disagree about what "not loaded" means.
 */
export function busLoaded(pi: Pick<ExtensionAPI, "getAllTools">): boolean {
	return pi.getAllTools().some((tool) => tool.name === SESSION_TOOL);
}

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
	if (!busLoaded(pi)) return { ok: false, error: NO_BUS };
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

/**
 * `ctx` as a tool context, when it is one.
 *
 * `executeTool` is the whole difference between the two kinds — a tool context has it, a
 * command context does not — so its presence is what makes a nested call possible.
 */
function toolContext(ctx: ExtensionContext): ExtensionToolContext | undefined {
	const candidate = ctx as Partial<ExtensionToolContext>;
	return typeof candidate.executeTool === "function" ? (ctx as ExtensionToolContext) : undefined;
}

/**
 * Send one message, and report the labels a message file was written for.
 *
 * A tool's context calls the `session` tool, which is the bus's own validation and hooks; a
 * command's asks the bus over {@link SESSION_SEND_REQUEST}, because it cannot. Neither throws.
 */
export async function send(
	pi: Pick<ExtensionAPI, "events" | "getAllTools">,
	ctx: ExtensionContext,
	input: SendInput,
): Promise<SendResult> {
	const nested = toolContext(ctx);
	if (nested !== undefined) return nestedSend(nested, input);
	if (!busLoaded(pi)) return { ok: false, error: NO_BUS };
	return requestOverBus<SendResult, SessionSendRequest>(pi, {
		channel: SESSION_SEND_REQUEST,
		payload: (respond) => ({ ctx, input, respond }),
		unclaimed: () => ({ ok: false, error: NO_BUS }),
		failed: (error) => ({ ok: false, error: messageOf(error) }),
	});
}

/** The nested `session send`, as a tool's context makes it. */
async function nestedSend(ctx: ExtensionToolContext, input: SendInput): Promise<SendResult> {
	const answer = await call(ctx, { action: "send", kind: input.kind, to: input.to, text: input.text });
	if ("error" in answer) return { ok: false, error: answer.error };
	const labels = (value: unknown): string[] =>
		Array.isArray(value) ? value.filter((label): label is string => typeof label === "string") : [];
	const failed = answer.details.failed;
	return {
		ok: true,
		delivered: labels(answer.details.delivered),
		failed: Array.isArray(failed)
			? failed.flatMap((entry) => {
					if (typeof entry !== "object" || entry === null) return [];
					const { label, error } = entry as Record<string, unknown>;
					return typeof label === "string" && typeof error === "string" ? [{ label, error }] : [];
				})
			: [],
	};
}

/** EventBus channel on which a caller asks `session-bus` to claim paths for it. */
export const SESSION_CLAIM_REQUEST = "my-pi-agent/session-claim/request";

/** EventBus channel on which a caller asks `session-bus` to release its claims. */
export const SESSION_RELEASE_REQUEST = "my-pi-agent/session-release/request";

/** One path another session already holds, as the bus reports it. */
export interface ClaimConflict {
	path: string;
	owner: string;
	ownerLabel: string;
}

/**
 * What claiming a card's paths did.
 *
 * A conflict is not a failure: the paths were asked for and somebody else holds them, which is
 * the fact the caller reports. The claim itself is all-or-nothing — the bus touches no file
 * when any path is taken — so `claimed` is empty whenever `conflicts` is not.
 */
export type ClaimPathsResult =
	| { ok: true; claimed: string[]; conflicts: ClaimConflict[] }
	| { ok: false; error: string };

/** What releasing them did. `notOwned` is ordinary: nothing was held under that path. */
export type ReleasePathsResult = { ok: true; released: string[]; notOwned: string[] } | { ok: false; error: string };

/** What a claim asks of the bus when the caller's context cannot make a nested call. */
export interface SessionClaimRequest {
	/** The caller's context; the bus starts through it, as it does for a join. */
	ctx: ExtensionContext;
	paths: readonly string[];
	/** Claimed once, with what the bus answered. */
	respond(result: BusAnswer<ClaimPathsResult>): void;
}

/** What a release asks of the bus, on the same terms. */
export interface SessionReleaseRequest {
	ctx: ExtensionContext;
	paths: readonly string[];
	respond(result: BusAnswer<ReleasePathsResult>): void;
}

/**
 * Claim paths for this session, as the board holds the files a card names.
 *
 * Two transports, and the context decides: a tool's context makes the nested call, where the
 * bus's own validation and hooks run, and any other asks {@link SESSION_CLAIM_REQUEST} — the
 * board's re-claim runs in `before_agent_start`, which has no `executeTool`, and that gap is
 * what made it answer "needs a tool context" and do nothing. The empty list short-circuits,
 * because most cards name no paths and the bus's answer would be "Nothing claimed." either way.
 */
export async function claimPaths(
	pi: Pick<ExtensionAPI, "events" | "getAllTools">,
	ctx: ExtensionContext,
	paths: readonly string[],
): Promise<ClaimPathsResult> {
	if (paths.length === 0) return { ok: true, claimed: [], conflicts: [] };
	const nested = toolContext(ctx);
	if (nested !== undefined) {
		const answer = await call(nested, { action: "claim", paths: [...paths] });
		if ("error" in answer) return { ok: false, error: answer.error };
		return {
			ok: true,
			claimed: stringsOf(answer.details.claimed),
			conflicts: conflictsOf(answer.details.conflicts),
		};
	}
	if (!busLoaded(pi)) return { ok: false, error: NO_BUS };
	return requestOverBus<ClaimPathsResult, SessionClaimRequest>(pi, {
		channel: SESSION_CLAIM_REQUEST,
		payload: (respond) => ({ ctx, paths: [...paths], respond }),
		unclaimed: () => ({ ok: false, error: NO_BUS }),
		failed: (error) => ({ ok: false, error: messageOf(error) }),
	});
}

/** Release this session's claims on `paths`. Not holding one is an answer, not a failure. */
export async function releasePaths(
	pi: Pick<ExtensionAPI, "events" | "getAllTools">,
	ctx: ExtensionContext,
	paths: readonly string[],
): Promise<ReleasePathsResult> {
	if (paths.length === 0) return { ok: true, released: [], notOwned: [] };
	const nested = toolContext(ctx);
	if (nested !== undefined) {
		const answer = await call(nested, { action: "release", paths: [...paths] });
		if ("error" in answer) return { ok: false, error: answer.error };
		return {
			ok: true,
			released: stringsOf(answer.details.released),
			notOwned: stringsOf(answer.details.notOwned),
		};
	}
	if (!busLoaded(pi)) return { ok: false, error: NO_BUS };
	return requestOverBus<ReleasePathsResult, SessionReleaseRequest>(pi, {
		channel: SESSION_RELEASE_REQUEST,
		payload: (respond) => ({ ctx, paths: [...paths], respond }),
		unclaimed: () => ({ ok: false, error: NO_BUS }),
		failed: (error) => ({ ok: false, error: messageOf(error) }),
	});
}

/** The strings in a details field, when it is a list of them. */
function stringsOf(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** The conflicts in a details field, when it is the bus's shape. */
function conflictsOf(value: unknown): ClaimConflict[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null) return [];
		const { path, owner, ownerLabel } = entry as Record<string, unknown>;
		if (typeof path !== "string" || typeof owner !== "string" || typeof ownerLabel !== "string") return [];
		return [{ path, owner, ownerLabel }];
	});
}
