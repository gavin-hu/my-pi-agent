/**
 * The `/prompt` command: a small subcommand dispatcher.
 *
 * `/prompt refine [on|off|status]` reads or changes the session's refinement
 * state. The override is session-only by design; the config file is the durable
 * switch and is re-read at `session_start`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PromptRuntime } from "./runtime.ts";

const USAGE = "Usage: /prompt refine [on|off|status]";

/** Current state, phrased for a notification. */
function statusLine(runtime: PromptRuntime): string {
	const config = runtime.getConfig();
	const state = runtime.isEnabled() ? "on" : "off";
	return `Prompt refinement is ${state} (up to ${config.maxQuestions} questions, ${config.minLength}+ characters).`;
}

export function registerCommands(pi: ExtensionAPI, runtime: PromptRuntime): void {
	pi.registerCommand("prompt", {
		description: "Prompt refinement: /prompt refine [on|off|status]",
		handler: async (args, ctx) => {
			const tokens = args
				.trim()
				.split(/\s+/)
				.filter((token) => token.length > 0);
			const subcommand = tokens[0]?.toLowerCase();

			if (!subcommand || subcommand === "help") {
				ctx.ui.notify(`${USAGE}\n${statusLine(runtime)}`, "info");
				return;
			}
			if (subcommand !== "refine") {
				ctx.ui.notify(`Unknown subcommand "${subcommand}". ${USAGE}`, "warning");
				return;
			}

			const action = tokens[1]?.toLowerCase();
			if (!action || action === "status") {
				ctx.ui.notify(statusLine(runtime), "info");
				return;
			}
			if (action === "on") {
				runtime.setEnabled(true);
				ctx.ui.notify("Prompt refinement on.", "info");
				return;
			}
			if (action === "off") {
				runtime.setEnabled(false);
				ctx.ui.notify("Prompt refinement off.", "info");
				return;
			}
			ctx.ui.notify(`Unknown argument "${action}". ${USAGE}`, "warning");
		},
	});
}
