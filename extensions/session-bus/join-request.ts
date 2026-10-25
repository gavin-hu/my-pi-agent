/**
 * The join request, answered.
 *
 * `board` and `team` sit above the bus: `/board`, `/team join`, and a card write all
 * put this session on the team, and none of them may import this extension. A *tool*
 * context could reach the `session` tool and an `ExtensionCommandContext` cannot —
 * the same limit `lib/plan-entry.ts` works around for plan mode — so the request
 * travels on `pi.events` and this module answers it with the runtime's own `join`.
 *
 * The answer always comes: every path here ends in `respond`, including a failure, so
 * a caller never waits on a listener that threw. The label also becomes Pi's session
 * name, because a team label and the footer have to agree.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../../lib/errors.ts";
import { type JoinResult, TEAM_JOIN_REQUEST, type TeamJoinRequest } from "../../lib/session-tool.ts";
import type { SessionBus } from "./runtime.ts";

export function registerJoinRequests(pi: ExtensionAPI, bus: SessionBus): void {
	pi.events.on(TEAM_JOIN_REQUEST, (data) => {
		const request = data as TeamJoinRequest | undefined;
		if (!request || typeof request.respond !== "function") return;
		void answer(request);
	});

	async function answer(request: TeamJoinRequest): Promise<void> {
		let result: JoinResult;
		try {
			await bus.start(request.ctx);
			const joined = await bus.join(request.input);
			// One identity: the bus's label is also the name Pi's footer and `/resume` show.
			if (request.input.label !== undefined) pi.setSessionName(joined.label);
			result = { ok: true, label: joined.label, watching: joined.watching };
		} catch (error) {
			result = { ok: false, error: messageOf(error) };
		}
		request.respond(result);
	}
}
