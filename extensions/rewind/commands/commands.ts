/**
 * Slash command for the rewind extension.
 *
 * One `/rewind` command opens the timeline of user prompts on the active
 * branch. Picking a point hands off to `rewindTo`, which asks whether to
 * restore code, conversation, or both. Modes without an interactive picker get
 * a plain list.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { withRailsSuppressed } from "../../../lib/rails.ts";
import { formatRewindListText, formatRewindRow } from "../text/format.ts";
import type { RewindRuntime } from "../state/runtime.ts";
import { buildRewindPoints, type RewindPoint } from "../state/timeline.ts";

/** Pick a point from the timeline, or undefined when the user cancels. */
async function choosePoint(ctx: ExtensionCommandContext, points: RewindPoint[]): Promise<RewindPoint | undefined> {
	if (ctx.mode === "tui") {
		// The timeline is the TUI's: the picker below and registration load neither.
		const { RewindListComponent } = await import("../view/rewind-tui.ts");
		return ctx.ui.custom<RewindPoint | undefined>(
			(tui, theme, _keybindings, done) =>
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
async function openRewind(pi: ExtensionAPI, runtime: RewindRuntime, ctx: ExtensionCommandContext): Promise<void> {
	const root = await runtime.rootFor(ctx);
	const snapshots = root ? await runtime.list(root) : [];
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

	const point = await withRailsSuppressed(pi, () => choosePoint(ctx, points));
	if (!point) return;
	// The rewind run and the review gate both load on the verb that needs them: the
	// listing above and registration load neither.
	const { rewindTo } = await import("./rewind.ts");
	await rewindTo(pi, runtime, ctx, root, point);
}

export function registerCommands(pi: ExtensionAPI, runtime: RewindRuntime): void {
	pi.registerCommand("rewind", {
		description: "Rewind the working tree and/or conversation to an earlier prompt",
		handler: async (_args, ctx) => {
			await openRewind(pi, runtime, ctx);
		},
	});

	pi.registerCommand("review", {
		description: "Review the latest turn's changes and revert a file or the whole turn",
		handler: async (_args, ctx) => {
			const { openReview } = await import("./review.ts");
			await openReview(pi, runtime, ctx);
		},
	});
}
