/**
 * session-bus — coordinate parallel Pi sessions on one repository.
 *
 * A terminal session joins on `session_start`; RPC, JSON, print, and WeChat peer
 * sessions join only when the tool or `/sessions` is used. The factory only
 * registers; the runtime owns the heartbeat and removes the registry entry on
 * shutdown. No network, no model turn, and no automatic context injection.
 *
 * Load with:  pi --extension ./extensions/session-bus
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { messageOf } from "../../lib/errors.ts";
import { registerCommands } from "./commands.ts";
import { createSessionBus, type SessionBus } from "./runtime.ts";
import { registerTools } from "./tools.ts";

export interface SessionBusDeps {
	/** Test seam: a runtime with a temp dir and fixed clock. */
	bus?: SessionBus;
}

export default function sessionBus(pi: ExtensionAPI, deps: SessionBusDeps = {}): void {
	if (!isExtensionEnabled("session-bus")) return;
	const bus = deps.bus ?? createSessionBus(pi);

	registerTools(pi, bus);
	registerCommands(pi, bus);

	pi.on("session_start", async (_event, ctx) => {
		try {
			await bus.start(ctx);
		} catch (error) {
			ctx.ui.notify(`Session bus did not start: ${messageOf(error)}`, "warning");
		}
	});
	pi.on("session_shutdown", async () => {
		await bus.stop();
	});
}
