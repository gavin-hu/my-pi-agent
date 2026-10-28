/**
 * The join request, answered.
 *
 * `board` and `team` sit above the bus: `/board`, `/team join`, and a card write all
 * put this session on the team, and none of them may import this extension. A *tool*
 * context could reach the `session` tool and an `ExtensionCommandContext` cannot —
 * the same limit `lib/plan-entry.ts` works around for plan mode — so the request
 * travels on `pi.events` and this module answers it with the runtime's own `join`.
 *
 * The answer always comes: every path here returns a result, including a failure, so
 * a caller never waits on a listener that threw. A caller that asks for `name` also gets
 * Pi's session name, because `/team join <label>` is the one door that means "call me
 * this from now on"; every other join leaves the footer alone.
 *
 * The claim is the answer, not the result: the bus starts and joins asynchronously, so
 * this answers with the promise and stays claimed while it runs — which is what keeps
 * the caller's fallback from settling a join that is still happening.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../../lib/errors.ts";
import { type JoinResult, TEAM_JOIN_REQUEST, type TeamJoinRequest } from "../../lib/session-tool.ts";
import type { SessionBus } from "./runtime.ts";

export function registerJoinRequests(pi: ExtensionAPI, bus: SessionBus): void {
	pi.events.on(TEAM_JOIN_REQUEST, (data) => {
		const request = data as TeamJoinRequest | undefined;
		if (!request || typeof request.respond !== "function") return;
		request.respond(answer(request));
	});

	async function answer(request: TeamJoinRequest): Promise<JoinResult> {
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
}
