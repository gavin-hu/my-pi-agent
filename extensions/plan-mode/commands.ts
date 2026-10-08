/**
 * Slash commands for the plan-mode extension.
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
		description: "Toggle plan mode, or plan a task: /plan [prompt]",
		handler: async (args, ctx) => {
			const prompt = args.trim();

			// `/plan` toggles; `/plan <prompt>` enters plan mode and sends the task.
			if (!prompt) {
				runtime.toggle(ctx);
				ctx.ui.notify(planModeNotice(runtime.isEnabled()), "info");
				return;
			}

			if (!runtime.isEnabled()) {
				runtime.enable(ctx);
				ctx.ui.notify(ENABLED_NOTICE, "info");
			}
			if (ctx.isIdle()) pi.sendUserMessage(prompt);
			else pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});
}
