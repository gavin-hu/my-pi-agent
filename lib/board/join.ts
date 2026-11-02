/**
 * The one join both surfaces ask for: the ask-once rule, and what a failure means.
 *
 * `board` joins when the page opens and when a card is claimed; `team` joins when a card
 * is claimed through the round, and `/team join` asks the bus directly. The asking is
 * shared because the rule around it is easy to get different in two places: ask only
 * while this session is not on the team, so a card write costs one request per session
 * rather than one per card, and never let the join undo a card that was already written —
 * a bus that is not loaded is a sentence, not an exception.
 *
 * Being on the team is read from the bus's own record, not from the standing alone: a
 * standing says a join once answered `ok`, and stays true after the bus stops, after the
 * TTL prunes the record, and after a `/resume` takes the seat over — so a claim that
 * trusted it would write a card under a name no peer resolves. The roster is that same
 * question asked of the files, which is what the round already reads.
 *
 * `lib/` is value-only, so the session and the join arrive as parameters, exactly as the
 * store does for the tools.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../errors.ts";
import { sessionIdOf } from "../session-label.ts";
import { readRoster, type RosterSession, rosterStateOf } from "../session-roster.ts";
import type { JoinResult, TeamJoin, TeamJoinInput } from "../session-tool.ts";
import type { BoardSession } from "./session.ts";

/**
 * The part of the session a join reads: where it stands, the clock, and the bus's files.
 *
 * All three, because being on the team is one rule and neither caller may answer it with
 * a different roster: the standing is what the last ask did, the clock is what the roster's
 * liveness is judged by, and the directory is the bus's word for this repository.
 */
export type JoinSession = Pick<BoardSession, "team" | "busDir" | "now">;

/**
 * Put this session on the team, unless the bus still holds it.
 *
 * A failure is recorded and asked again by the next claim, and so is a success the roster
 * does not back any more; a join that threw is swallowed here for the same reason, because
 * the card it came after is already true.
 */
export async function joinOnce(
	session: JoinSession,
	team: TeamJoin,
	ctx: ExtensionContext,
	label: string,
): Promise<void> {
	const standing = session.team.last();
	if (standing?.ok === true && (await onRoster(session, ctx))) return;
	try {
		session.team.record(await team.join(ctx, askAgain(standing, label)));
	} catch (error) {
		session.team.record({ ok: false, error: messageOf(error) });
	}
}

/**
 * Whether the bus holds a live record for this session, which is the one fact a standing cannot keep.
 *
 * Two answers are not evidence against the standing, so both keep it rather than spend a
 * join on a guess: a host that reports no session id has no record to look for, and a
 * roster that cannot be read says nothing about the record it holds. Neither may throw —
 * this runs after a card was written, and a claim is not undone by a bus that would not say.
 */
async function onRoster(session: JoinSession, ctx: ExtensionContext): Promise<boolean> {
	const id = sessionIdOf(ctx);
	if (id === undefined) return true;
	let roster: RosterSession[] | undefined;
	try {
		roster = await readRoster(await session.busDir(ctx.cwd));
	} catch {
		return true;
	}
	const mine = roster?.find((record) => record.id === id);
	return mine !== undefined && rosterStateOf(mine, session.now()) === "live";
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
