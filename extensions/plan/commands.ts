/**
 * Slash command for the plan-mode extension.
 *
 * `/plan` toggles plan mode, or enters it and sends an optional task;
 * `Ctrl+Alt+P` toggles too.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { READ_ONLY_SUMMARY } from "./policy.ts";
import type { PlanRuntime } from "./runtime.ts";

const ENABLED_NOTICE = `Plan mode enabled — ${READ_ONLY_SUMMARY}.`;
const DISABLED_NOTICE = "Plan mode disabled — full access restored.";

/** Notice text for the current mode; shared by `/plan` and the `Ctrl+Alt+P` shortcut. */
export function planModeNotice(enabled: boolean): string {
	return enabled ? ENABLED_NOTICE : DISABLED_NOTICE;
}

export function registerCommands(pi: ExtensionAPI, runtime: PlanRuntime): void {
	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration), or enter it with an optional task",
		handler: async (args, ctx) => {
			const prompt = args.trim();

			// No task: toggle, exactly like Ctrl+Alt+P.
			if (!prompt) {
				runtime.toggle(ctx);
				ctx.ui.notify(planModeNotice(runtime.isEnabled()), "info");
				return;
			}

			// A task always means "plan this": enter if needed, then send.
			if (!runtime.isEnabled()) {
				runtime.enable(ctx);
				ctx.ui.notify(ENABLED_NOTICE, "info");
			}
			if (ctx.isIdle()) await pi.sendUserMessage(prompt);
			else await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});
}
