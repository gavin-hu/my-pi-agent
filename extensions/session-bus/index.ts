/**
 * session-bus — coordinate parallel Pi sessions on one repository.
 *
 * No session joins on start: it joins by naming itself, or by the first action
 * that makes it addressable, in any mode. `/sessions` and `status` only read, so a
 * fresh board is empty and a peer never appears merely because the package
 * loaded. The factory only
 * registers; the runtime owns the heartbeat and removes the registry entry on
 * shutdown. Nothing arms an inbox watch by itself, so delivery stays pull-based
 * until a session asks: with the watch armed, new mail is reported at the next
 * turn, or — with `wake` — raises one turn as soon as the agent is idle,
 * including right after a running turn settles.
 *
 * Load with:  pi --extension ./extensions/session-bus
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { messageOf } from "../../lib/errors.ts";
import { createPendingReporter, registerPendingChannel } from "../../lib/report.ts";
import { registerCommands } from "./commands.ts";
import { registerJoinRequests } from "./join-request.ts";
import { createSessionBus, type SessionBus } from "./runtime.ts";
import { registerTools } from "./tools.ts";
import { mailNotice } from "./notice.ts";
import type { BusMessage } from "./types.ts";

export interface SessionBusDeps {
	/** Test seam: a runtime with a temp dir and fixed clock. */
	bus?: SessionBus;
}

export default function sessionBus(pi: ExtensionAPI, deps: SessionBusDeps = {}): void {
	if (!isExtensionEnabled("session-bus")) return;
	const bus = deps.bus ?? createSessionBus(pi);

	const reporter = createPendingReporter<BusMessage>({
		wake: (notice) => pi.sendMessage(notice, { triggerTurn: true }),
		pending: () => bus.pending(),
		markReported: (messages) => bus.markReported(messages.map((message) => message.id)),
		buildNotice: mailNotice,
		source: "session-bus",
		wakeRequested: () => bus.wantsWake(),
	});

	registerTools(pi, bus);
	registerCommands(pi, bus);
	// `board` and `team` join this session through one request: their commands cannot call
	// a tool, and the user's surface for the team is theirs, not this extension's.
	registerJoinRequests(pi, bus);

	registerPendingChannel(pi, {
		reporter,
		runtime: {
			// A start failure is reported once and leaves the runtime retryable: the next
			// tool call starts it again, and a bus that never started simply never polls.
			load: async (ctx) => {
				try {
					await bus.start(ctx);
				} catch (error) {
					ctx.ui.notify(`Session bus did not start: ${messageOf(error)}`, "warning");
				}
			},
			shutdown: () => bus.stop(),
		},
		// A reload or a replaced session reuses the runtime, so the mail trigger is
		// armed on every session start and cleared before the runtime releases.
		onSessionStart: () => {
			bus.onWake = () => reporter.report();
		},
		onSessionShutdown: () => {
			bus.onWake = undefined;
		},
	});
}
