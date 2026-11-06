/**
 * The one join the board's doors ask for: the ask-once rule, and what a failure means.
 *
 * `board` joins when the page opens and when a card is claimed; `team` joins when a card
 * is claimed through the round, and on the handoff and the question it sends. `/team join`
 * is the fifth door and asks the bus directly, because a typed label is a rename: it lands
 * on the label it was given even when the bus already holds this session.
 *
 * The asking is shared because the rule around it is easy to get different in two places:
 * ask only while this session is not on the team, so a card write costs one request per
 * session rather than one per card, and never let the join undo a card that was already
 * written — a bus that is not loaded is a sentence, not an exception.
 *
 * Being on the team is read from the bus's own record, not from the standing alone: a
 * standing says a join once answered `ok`, and stays true after the bus stops, after the
 * TTL prunes the record, and after a `/resume` takes the seat over — so a claim that
 * trusted it would write a card under a name no peer resolves. The roster is that same
 * question asked of the files, which is what the round already reads.
 *
 * The record is also the only word on *which* name the bus holds, and that is why a join
 * asks when the label differs: the page serves as the seat, so opening it renames a session
 * that held another name, while a session already seated asks nothing.
 *
 * `lib/` is value-only, so the session and the join arrive as parameters, exactly as the
 * store does for the tools.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../errors.ts";
import { sessionIdOf } from "../session-label.ts";
import { type RosterSession, rosterStateOf } from "../session-roster.ts";
import type { JoinResult, TeamJoin, TeamJoinInput } from "../session-tool.ts";
import type { BoardSession } from "./session.ts";

/**
 * The part of the session a join reads: where it stands, the clock, and the bus's records.
 *
 * All three, because being on the team is one rule and neither caller may answer it with
 * a different roster: the standing is what the last ask did, the clock is what the roster's
 * liveness is judged by, and the records are the bus's word for this repository.
 */
export type JoinSession = Pick<BoardSession, "team" | "roster" | "now">;

/**
 * What a `/board` line says about the team: the name peers resolve, and whether mail will
 * reach this session.
 *
 * The listening fact is optional because two answers are honest without it: a record written
 * before the field existed, and a session a bus never recorded. A line that guessed would
 * accuse a peer of ignoring mail, so the word is left out instead.
 */
export type TeamState = { label: string; listening?: boolean } | { error: string };

/** A standing or a fresh answer, as the line reads it. */
export function standingOf(result: JoinResult | undefined): TeamState | undefined {
	if (result === undefined) return undefined;
	if (!result.ok) return { error: result.error };
	return { label: result.label, listening: result.watching.armed };
}

/** What one live record says: the name it holds, and its watch when the record carries one. */
interface Held {
	label: string;
	listening?: boolean;
}

/**
 * The roster's answer about this session: a live record, no record, or no word at all.
 *
 * `absent` and `unknown` are different facts — a bus that has not recorded this session is
 * a join to spend, while a roster that cannot be read is no evidence either way — and they
 * are kept apart for the same reason `lib/session-roster.ts` says a missing directory is not
 * an error: a guess either way would be a write under a name nothing backs.
 */
type RosterAnswer = { kind: "held"; held: Held } | { kind: "absent" } | { kind: "unknown" };

/**
 * Whether `a` and `b` are one name: a label is case-insensitive when it is a send target, so
 * it is here too, exactly as `holds` compares an owner.
 */
function sameLabel(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

/** A state from a live record, with the standing filling in a listening fact it cannot say. */
function stateOfHeld(held: Held, known: TeamState | undefined): TeamState {
	const listening = held.listening ?? (known !== undefined && "label" in known ? known.listening : undefined);
	return listening === undefined ? { label: held.label } : { label: held.label, listening };
}

/**
 * Put this session on the team, unless the bus still holds it under the name asked for.
 *
 * A failure is recorded and asked again by the next door, and so is a success the roster
 * does not back any more; a join that threw is swallowed here for the same reason, because
 * the card it came after is already true. The ask is recorded rather than returned alone,
 * so no door has to remember to do it.
 */
export async function joinTeam(
	session: JoinSession,
	team: TeamJoin,
	ctx: ExtensionContext,
	label: string,
): Promise<TeamState | undefined> {
	const standing = session.team.last();
	const answer = await rosterAnswer(session, ctx);
	if (standing?.ok === true) {
		// No word from the bus keeps the standing: the record may be there and unreadable, and a
		// join spent on a guess would rename a session the bus still holds.
		if (answer.kind === "unknown") return standingOf(standing);
		if (answer.kind === "held" && sameLabel(answer.held.label, label))
			return stateOfHeld(answer.held, standingOf(standing));
	}
	const joined = await ask(team, ctx, askAgain(standing, label));
	session.team.record(joined);
	return standingOf(joined);
}

/**
 * What this session's team is now, for `/board status`.
 *
 * The live record first: its label is what a peer resolves, and its `watching` is the fact a
 * disarm through `/session join` changes without telling this session. The standing answers
 * only when the bus cannot, so the line is right even when the last join is old.
 */
export async function teamStatus(session: JoinSession, ctx: ExtensionContext): Promise<TeamState | undefined> {
	const standing = session.team.last();
	const answer = await rosterAnswer(session, ctx);
	if (answer.kind === "held") return stateOfHeld(answer.held, standingOf(standing));
	return standingOf(standing);
}

/** The one ask, so a thrown request is recorded like a refused one. */
async function ask(team: TeamJoin, ctx: ExtensionContext, input: TeamJoinInput): Promise<JoinResult> {
	try {
		return await team.join(ctx, input);
	} catch (error) {
		return { ok: false, error: messageOf(error) };
	}
}

/**
 * Whether the bus holds a live record for this session, and under which name.
 *
 * Two answers are not evidence against the standing, so both keep it rather than spend a
 * join on a guess: a host that reports no session id has no record to look for, and a
 * roster that cannot be read says nothing about the record it holds. Neither may throw —
 * this runs after a card was written, and a claim is not undone by a bus that would not say.
 */
async function rosterAnswer(session: JoinSession, ctx: ExtensionContext): Promise<RosterAnswer> {
	const id = sessionIdOf(ctx);
	if (id === undefined) return { kind: "unknown" };
	let roster: RosterSession[] | undefined;
	try {
		roster = await session.roster(ctx.cwd);
	} catch {
		return { kind: "unknown" };
	}
	const record = roster?.find((entry) => entry.id === id);
	if (record === undefined || rosterStateOf(record, session.now()) !== "live") return { kind: "absent" };
	return {
		kind: "held",
		held: { label: record.label, ...(record.watching === undefined ? {} : { listening: record.watching.armed }) },
	};
}

/**
 * The join to ask again for, which repeats the choice the standing recorded.
 *
 * `armed: false` is the user's `/session listen off`, not a failure to repair: a re-ask
 * that armed the watch would undo it, so the ask is the same disarmed join. A watch that
 * was armed is asked for again with the wake it had, so a session woken for its mail stays
 * woken.
 */
function askAgain(standing: JoinResult | undefined, label: string): TeamJoinInput {
	if (standing?.ok !== true) return { label };
	const { armed, wake } = standing.watching;
	if (!armed) return { label, listen: false };
	return wake ? { label, wake } : { label };
}
