/**
 * The `/keep-awake` command.
 *
 * `on` / `off` force the inhibitor for the rest of the session; `auto` clears
 * the override and follows the configured mode; `status` (or no argument)
 * reports the current state.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { overrideNotice, statusNotice } from "./format.ts";
import type { KeepAwakeRuntime } from "./runtime.ts";
import type { KeepAwakeOverride } from "./types.ts";

const USAGE = "Usage: /keep-awake [on|off|auto|status]";

export function registerCommands(pi: ExtensionAPI, runtime: KeepAwakeRuntime): void {
	pi.registerCommand("keep-awake", {
		description: "Hold the machine awake: on, off, auto, or status",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "" || action === "status") {
				ctx.ui.notify(statusNotice(runtime.status()), "info");
				return;
			}
			if (action === "on" || action === "off") {
				const override: KeepAwakeOverride = action;
				runtime.setOverride(override, ctx);
				ctx.ui.notify(overrideNotice(override, runtime.status()), "info");
				return;
			}
			if (action === "auto") {
				runtime.setOverride(undefined, ctx);
				ctx.ui.notify(overrideNotice(undefined, runtime.status()), "info");
				return;
			}
			ctx.ui.notify(USAGE, "warning");
		},
	});
}
