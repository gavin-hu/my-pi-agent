/**
 * `/agents` — inspect, collect, and cancel background subagent runs.
 *
 * The board is a view over the session branch plus the live runtime; collecting
 * closes the board and sends the result as a user message so the next turn sees
 * it. Headless modes print the same list without actions. Plan mode keeps the
 * board — a run started before the plan was entered is the one write a refusal
 * cannot stop, and cancelling it is the only way out — while withholding the
 * collect, which writes a result into a session meant to be read-only.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { isPlanModeEnabled } from "../../lib/mode-state.ts";
import type { BackgroundRuntime } from "./background.ts";
import { formatAgentsList } from "./format.ts";

/** Open `/agents`; the TUI gets the board, other modes get the list. */
export async function openAgents(
	pi: ExtensionAPI,
	background: BackgroundRuntime,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const planning = isPlanModeEnabled(ctx.sessionManager.getBranch());
	const runs = background.list(ctx.sessionManager.getBranch());
	if (ctx.mode !== "tui") {
		ctx.ui.notify(formatAgentsList(runs), "info");
		return;
	}
	if (runs.length === 0) {
		ctx.ui.notify("No background subagents yet.", "info");
		return;
	}

	// The board is the TUI's: the list above and registration load neither it nor
	// its rails wrapper.
	const { withRailsSuppressed } = await import("../../lib/rails.ts");
	const { AgentsBoardComponent } = await import("./view/agents-board.ts");
	let collectId: string | undefined;
	await withRailsSuppressed(pi, async () => {
		await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
			const unsubscribe = background.subscribe(() => tui.requestRender());
			const component = new AgentsBoardComponent({
				runs: () => background.list(ctx.sessionManager.getBranch()),
				theme,
				collectable: () => !planning,
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
