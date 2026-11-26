/**
 * The leave request, answered.
 *
 * `team` sits above the bus and may not import it, and `/team exit` is a *command* — no
 * `ctx.executeTool` — so the ask travels on `pi.events` and this module answers it with the
 * runtime's own `leave`, the way `join-request.ts` answers a join.
 *
 * There is no `bus.start()` here, and that is the one difference from the join: a start mints the
 * record, and a person asking to leave must not be joined by the act of leaving. A session the bus
 * never started answers with nothing to give up, which is the truth it reads.
 *
 * The answer always comes: every path here returns a result, including a failure, so a caller never
 * waits on a listener that threw.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { answerOn } from "../../lib/bus-request.ts";
import { messageOf } from "../../lib/errors.ts";
import { type LeaveResult, TEAM_LEAVE_REQUEST, type TeamLeaveRequest } from "../../lib/session-tool.ts";
import type { SessionBus } from "./runtime.ts";

export function registerLeaveRequests(pi: ExtensionAPI, bus: SessionBus): void {
	answerOn<LeaveResult, TeamLeaveRequest>(pi, TEAM_LEAVE_REQUEST, answer);

	async function answer(): Promise<LeaveResult> {
		try {
			return { ok: true, ...(await bus.leave()) };
		} catch (error) {
			return { ok: false, error: messageOf(error) };
		}
	}
}
