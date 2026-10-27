/**
 * Board's side of the team: the one call that puts this session on it.
 *
 * The user's surface is `/board` and `team`; the session bus is the transport under
 * them. So the board joins on the user's behalf — when the page opens, and the first
 * time this session claims a card — and never asks anybody to run a bus action.
 *
 * The label it asks for is the session's own team name (`BoardSession.who`), so the
 * card, the bus record, and the roster say one word, and joining never renames the
 * session: the footer keeps the name the user gave it.
 *
 * The seam exists for the same reason `team`'s dispatch does: a board suite drives a
 * recording join instead of a bus, and the shipped implementation is one in-process
 * request through `lib/session-tool.ts` (a command context cannot call a tool).
 */

import { messageOf } from "../../lib/errors.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JoinResult, TeamJoin } from "../../lib/session-tool.ts";
import type { TeamStanding } from "../../lib/board/session.ts";

/**
 * The join itself is `lib/session-tool.ts`'s, because `team` asks for it too; this
 * module only holds what is the board's — when it asks, and how the outcome reads on a
 * `/board` line.
 */
export type { TeamJoin } from "../../lib/session-tool.ts";

/**
 * Put this session on the team, once: the first card it claims.
 *
 * Asked only while the standing does not say this session is on the team, so a card
 * write costs one request for the session rather than one per card. A failure is
 * recorded and asked again by the next claim; a bus that is not loaded answers with a
 * sentence, which is a result and not an exception — and a join that did throw still
 * must not undo the card that was already written, so it is swallowed here.
 */
export async function joinOnClaim(
	standing: TeamStanding,
	team: TeamJoin,
	ctx: ExtensionContext,
	label: string,
): Promise<void> {
	if (standing.last()?.ok === true) return;
	try {
		standing.record(await team.join(ctx, { label }));
	} catch (error) {
		standing.record({ ok: false, error: messageOf(error) });
	}
}

/**
 * What the join did, as a clause for a `/board` line.
 *
 * A board with no bus still serves, so the failure is a clause and not an error: the
 * page works, and the line says there is no team to hand work over.
 */
export function teamLine(result: JoinResult | undefined): string {
	if (result === undefined) return "";
	if (!result.ok) return ` · no team (${result.error})`;
	const state = result.watching.armed ? "listening" : "not listening";
	return ` · on the team as ${result.label}, ${state}`;
}
