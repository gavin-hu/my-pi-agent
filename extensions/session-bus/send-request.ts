/**
 * The send request, answered.
 *
 * A *tool* context reaches the `session` tool's own `send` and an
 * `ExtensionCommandContext` cannot — the limit `lib/plan-entry.ts` works around for plan mode
 * — so a command that has something to say asks here instead, on `pi.events`, exactly as it
 * asks for a join. `/board approve` is the caller this exists for: the sign is the fact the
 * card's owner acts on, and the person's door has no nested call to send it with.
 *
 * The answer is the tool's answer, one hop in: `sendOutcome` decides what the send is worth,
 * so the owner is told, or the caller is told why nobody was, whichever door asked. Every
 * path returns a result, so a caller never waits on a listener that threw.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../../lib/errors.ts";
import { type SendResult, SESSION_SEND_REQUEST, type SessionSendRequest } from "../../lib/session-tool.ts";
import { sendOutcome } from "./protocol.ts";
import type { SessionBus } from "./runtime.ts";

export function registerSendRequests(pi: ExtensionAPI, bus: SessionBus): void {
	pi.events.on(SESSION_SEND_REQUEST, (data) => {
		const request = data as SessionSendRequest | undefined;
		if (!request || typeof request.respond !== "function") return;
		request.respond(answer(request));
	});

	async function answer(request: SessionSendRequest): Promise<SendResult> {
		try {
			// The bus starts through the caller's context, the way the tool's own first action
			// starts it: a send joins this session and records a sender, whichever door asked.
			await bus.start(request.ctx);
			return sendOutcome(await bus.send(request.input));
		} catch (error) {
			return { ok: false, error: messageOf(error) };
		}
	}
}
