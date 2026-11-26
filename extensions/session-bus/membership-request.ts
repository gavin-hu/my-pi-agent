/**
 * The team's membership requests, answered: joining and leaving.
 *
 * `board` and `team` sit above the bus: `/board`, `/team join`, a card write and `/team exit` all ask
 * this session's membership to change, and none of them may import this extension. A *tool* context
 * could reach the `session` tool and an `ExtensionCommandContext` cannot — the same limit
 * `lib/mode-entry.ts` works around for plan mode — so the ask travels on `pi.events` and this module
 * answers it with the runtime's own `join` and `leave`.
 *
 * One module for both doors because they are one subject and one direction, and because a second
 * module is a start the `session-bus` entry pays for: `test/dependencies.test.ts` holds its static
 * graph to a row that may only fall. The two answers differ in one fact, and it is the reason they
 * are written apart rather than as one call: a join starts the bus when it is not up, and a leave does
 * not — a start mints the record, and a person asking to leave must not be joined by the act of
 * leaving.
 *
 * The answer always comes: every path here returns a result, including a failure, so a caller never
 * waits on a listener that threw. A caller that asks for `name` also gets Pi's session name, because
 * `/team join <label>` is the one door that means "call me this from now on"; the footer draws the
 * roster label after every join either way, so a plain join changes the name on the bar without
 * renaming the session.
 *
 * The claim is the answer, not the result: the bus starts and joins asynchronously, so this answers
 * with the promise and stays claimed while it runs — which is what keeps the caller's fallback from
 * settling a join that is still happening.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { answerOn } from "../../lib/bus-request.ts";
import { messageOf } from "../../lib/errors.ts";
import {
	type JoinResult,
	type LeaveResult,
	TEAM_JOIN_REQUEST,
	TEAM_LEAVE_REQUEST,
	type TeamJoinRequest,
	type TeamLeaveRequest,
} from "../../lib/session-tool.ts";
import type { SessionBus } from "./runtime.ts";

export function registerMembershipRequests(pi: ExtensionAPI, bus: SessionBus): void {
	answerOn(pi, TEAM_JOIN_REQUEST, join);
	answerOn<LeaveResult, TeamLeaveRequest>(pi, TEAM_LEAVE_REQUEST, leave);

	async function join(request: TeamJoinRequest): Promise<JoinResult> {
		let result: JoinResult;
		try {
			await bus.start(request.ctx);
			// `name` is this wrapper's business, not the bus's: the record's label and Pi's
			// session name are two facts, and only a caller that asked gets both changed.
			const { name, ...input } = request.input;
			const joined = await bus.join(input);
			if (name === true && request.input.label !== undefined) pi.setSessionName(joined.label);
			result = { ok: true, label: joined.label, watching: joined.watching };
		} catch (error) {
			result = { ok: false, error: messageOf(error) };
		}
		return result;
	}

	async function leave(): Promise<LeaveResult> {
		try {
			return { ok: true, ...(await bus.leave()) };
		} catch (error) {
			return { ok: false, error: messageOf(error) };
		}
	}
}
