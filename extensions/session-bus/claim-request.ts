/**
 * The claim and release requests, answered.
 *
 * A *tool* context reaches the `session` tool's own `claim`/`release`, and an event handler
 * cannot: `before_agent_start` hands an `ExtensionContext` with no `executeTool`, which is
 * where `board` re-claims a resumed session's paths. So the claim a lane crossing makes by a
 * nested call is asked for here instead, on `pi.events`, exactly as a join and a send are.
 *
 * The answer is the tool's answer, one hop in: the bus starts through the caller's context,
 * `bus.claim`/`bus.release` write what the tool would have written, and every path returns a
 * result — including a failure — so a caller never waits on a listener that threw.
 *
 * The claim is the answer, not the result: the bus starts asynchronously, so this answers
 * with the promise and stays claimed while it runs, which is what keeps the caller's
 * fallback from settling a claim that is still happening.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../../lib/errors.ts";
import {
	type ClaimPathsResult,
	type ReleasePathsResult,
	SESSION_CLAIM_REQUEST,
	SESSION_RELEASE_REQUEST,
	type SessionClaimRequest,
	type SessionReleaseRequest,
} from "../../lib/session-tool.ts";
import type { SessionBus } from "./runtime.ts";

export function registerClaimRequests(pi: ExtensionAPI, bus: SessionBus): void {
	pi.events.on(SESSION_CLAIM_REQUEST, (data) => {
		const request = data as SessionClaimRequest | undefined;
		if (!request || typeof request.respond !== "function") return;
		request.respond(claimed(request));
	});
	pi.events.on(SESSION_RELEASE_REQUEST, (data) => {
		const request = data as SessionReleaseRequest | undefined;
		if (!request || typeof request.respond !== "function") return;
		request.respond(released(request));
	});

	async function claimed(request: SessionClaimRequest): Promise<ClaimPathsResult> {
		try {
			await bus.start(request.ctx);
			return { ok: true, ...(await bus.claim([...request.paths])) };
		} catch (error) {
			return { ok: false, error: messageOf(error) };
		}
	}

	async function released(request: SessionReleaseRequest): Promise<ReleasePathsResult> {
		try {
			await bus.start(request.ctx);
			return { ok: true, ...(await bus.release([...request.paths])) };
		} catch (error) {
			return { ok: false, error: messageOf(error) };
		}
	}
}
