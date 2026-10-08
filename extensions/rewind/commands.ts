/**
 * Slash command for the rewind extension.
 *
 * One `/rewind` command opens the timeline of user prompts on the active
 * branch. Picking a point hands off to `rewindTo`, which asks whether to
 * restore code, conversation, or both. Modes without an interactive picker get
 * a plain list.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatRewindListText, formatRewindRow } from "./format.ts";
import { rewindTo } from "./rewind.ts";
import type { RewindRuntime } from "./runtime.ts";
import { RewindListComponent } from "./rewind-tui.ts";
import { buildRewindPoints, type RewindPoint } from "./timeline.ts";

/** Pick a point from the timeline, or undefined when the user cancels. */
async function choosePoint(ctx: ExtensionCommandContext, points: RewindPoint[]): Promise<RewindPoint | undefined> {
	if (ctx.mode === "tui") {
		return ctx.ui.custom<RewindPoint | undefined>((tui, theme, _keybindings, done) =>
			new RewindListComponent({
				points,
				theme,
				onClose: (point) => done(point),
				requestRender: () => tui.requestRender(),
				viewportRows: () => tui.terminal?.rows,
			}),
		);
	}
	const labels = points.map((point) => formatRewindRow(point.summary, Boolean(point.snapshot), point.timestamp));
	const chosen = await ctx.ui.select("Rewind to which prompt?", labels);
	if (!chosen) return undefined;
	return points[labels.indexOf(chosen)];
}

/** Open the timeline and rewind to the chosen point. */
async function openRewind(runtime: RewindRuntime, ctx: ExtensionCommandContext): Promise<void> {
	const root = await runtime.rootFor(ctx);
	const snapshots = root ? await runtime.list(root, false) : [];
	const points = buildRewindPoints(ctx.sessionManager.getBranch(), snapshots, ctx.sessionManager.getSessionId());

	if (points.length === 0) {
		ctx.ui.notify("No prompts to rewind to yet.", "info");
		return;
	}
	if (!ctx.hasUI) {
		ctx.ui.notify(
			formatRewindListText(
				points.map((point) => ({
					summary: point.summary,
					timestamp: point.timestamp,
					hasSnapshot: Boolean(point.snapshot),
				})),
			),
			"info",
		);
		return;
	}

	const point = await choosePoint(ctx, points);
	if (!point) return;
	await rewindTo(runtime, ctx, root, point);
}

export function registerCommands(pi: ExtensionAPI, runtime: RewindRuntime): void {
	pi.registerCommand("rewind", {
		description: "Rewind the working tree and/or conversation to an earlier prompt",
		handler: async (_args, ctx) => {
			await openRewind(runtime, ctx);
		},
	});
}
