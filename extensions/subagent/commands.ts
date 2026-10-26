/**
 * `/agents` — inspect, collect, and cancel background subagent runs.
 *
 * The board is a view over the session branch plus the live runtime; collecting
 * closes the board and sends the result as a user message so the next turn sees
 * it. Headless modes print the same list without actions.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { planModeRefusal } from "../../lib/plan-entry.ts";
import { isPlanModeEnabled } from "../../lib/plan-state.ts";
import { withRailsSuppressed } from "../../lib/rails.ts";
import type { BackgroundRuntime } from "./background.ts";
import { AgentsBoardComponent } from "./background-tui.ts";
import { formatAgentsList } from "./format.ts";

/** Open `/agents`; the TUI gets the board, other modes get the list. */
async function openAgents(
	pi: ExtensionAPI,
	background: BackgroundRuntime,
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (isPlanModeEnabled(ctx.sessionManager.getBranch())) {
		ctx.ui.notify(planModeRefusal("managing background runs"), "warning");
		return;
	}

	const runs = background.list(ctx.sessionManager.getBranch());
	if (ctx.mode !== "tui") {
		ctx.ui.notify(formatAgentsList(runs), "info");
		return;
	}
	if (runs.length === 0) {
		ctx.ui.notify("No background subagents yet.", "info");
		return;
	}

	let collectId: string | undefined;
	await withRailsSuppressed(pi, async () => {
		await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
			const unsubscribe = background.subscribe(() => tui.requestRender());
			const component = new AgentsBoardComponent({
				runs: () => background.list(ctx.sessionManager.getBranch()),
				theme,
				onCollect: (runId) => {
					collectId = runId;
					unsubscribe();
					done();
				},
				onCancel: (runId) => {
					background.cancel(runId);
				},
				onClose: () => {
					unsubscribe();
					done();
				},
				requestRender: () => tui.requestRender(),
				viewportRows: () => tui.terminal?.rows,
			});
			return component;
		});
	});

	if (!collectId) return;
	const collected = background.collect(collectId, ctx.sessionManager.getBranch());
	if (!collected.ok) {
		ctx.ui.notify(collected.reason, "warning");
		return;
	}
	if (ctx.isIdle()) await pi.sendUserMessage(collected.text);
	else await pi.sendUserMessage(collected.text, { deliverAs: "followUp" });
}

export function registerAgentsCommand(pi: ExtensionAPI, background: BackgroundRuntime): void {
	pi.registerCommand("agents", {
		description: "Inspect, collect, or cancel background subagent runs",
		handler: async (_args, ctx) => {
			await openAgents(pi, background, ctx);
		},
	});
}
