/**
 * The one join both surfaces ask for: the ask-once rule, and what a failure means.
 *
 * `board` joins when the page opens and when a card is claimed; `team` joins when a card
 * is claimed through the round, and `/team join` asks the bus directly. The asking is
 * shared because the rule around it is easy to get different in two places: ask only
 * while the standing does not say this session is on the team, so a card write costs one
 * request per session rather than one per card, and never let the join undo a card that
 * was already written — a bus that is not loaded is a sentence, not an exception.
 *
 * `lib/` is value-only, so the join and the standing arrive as parameters, exactly as the
 * store does for the tools.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../errors.ts";
import type { TeamJoin } from "../session-tool.ts";
import type { TeamStanding } from "./session.ts";

/**
 * Put this session on the team, once.
 *
 * A failure is recorded and asked again by the next claim; a join that threw is
 * swallowed here for the same reason, because the card it came after is already true.
 */
export async function joinOnce(
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
