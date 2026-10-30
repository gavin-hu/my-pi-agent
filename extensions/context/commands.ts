/**
 * The `/context` command: the report, and the one action it justifies.
 *
 * A bare `/context` opens the screen in the TUI and prints the same facts as
 * text everywhere else. `/context compact [instructions]` is deliberately not a
 * second `/compact`: it refuses to start while a turn is streaming, because Pi's
 * own compaction begins with an abort, and reports the before/after numbers when
 * it finishes.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatTokens } from "../../lib/format.ts";
import { messageOf } from "../../lib/errors.ts";
import { collectInputs } from "./collect.ts";
import { formatReport } from "./format.ts";
import { buildReport } from "./report.ts";

/** The command's argument surface, shared by the description and the usage warning. */
const CONTEXT_USAGE = "/context [compact [instructions]]";

/** Advise the next token after `/context`. */
function completeArg(prefix: string): Array<{ value: string; label: string }> | null {
	const trimmed = prefix.trimStart();
	if (trimmed.includes(" ")) return null;
	const options = ["compact"].filter((option) => option.startsWith(trimmed));
	return options.length > 0 ? options.map((value) => ({ value: `${value} `, label: value })) : null;
}

/** The report as a screen in the TUI, or as a notification elsewhere. */
async function openReport(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const report = buildReport(collectInputs(pi, ctx));
	if (ctx.mode !== "tui") {
		ctx.ui.notify(formatReport(report));
		return;
	}

	// The dock screen owns the editor slot; hide the rails for its lifetime.
	const { withRailsSuppressed } = await import("../../lib/rails.ts");
	const { ContextComponent } = await import("./view/context-report.ts");
	await withRailsSuppressed(pi, () =>
		ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
			return new ContextComponent({
				theme,
				report,
				read: () => buildReport(collectInputs(pi, ctx)),
				isIdle: () => ctx.isIdle(),
				compact: (instructions, callbacks) => {
					ctx.compact({
						customInstructions: instructions,
						onComplete: callbacks.done,
						onError: callbacks.fail,
					});
				},
				close: () => done(),
				requestRender: () => tui.requestRender(),
				viewportRowsSource: () => tui.terminal?.rows,
			});
		}),
	);
}

/** Compact without interrupting a running turn, then report what changed. */
function compact(ctx: ExtensionCommandContext, instructions: string): void {
	if (!ctx.isIdle()) {
		ctx.ui.notify(
			"The agent is busy — a turn or a compaction is running. Wait for it to finish (or stop the turn) " +
				"before compacting; `/context compact` never interrupts a turn. Pi's `/compact` aborts it if that is what you want.",
			"warning",
		);
		return;
	}
	ctx.compact({
		customInstructions: instructions || undefined,
		onComplete: (result) => {
			const after = result.estimatedTokensAfter === undefined ? "?" : formatTokens(result.estimatedTokensAfter);
			ctx.ui.notify(`Compacted ${formatTokens(result.tokensBefore)} → ${after}.`, "info");
		},
		onError: (error) => ctx.ui.notify(`Compaction failed: ${messageOf(error)}`, "error"),
	});
}

export function registerCommands(pi: ExtensionAPI): void {
	pi.registerCommand("context", {
		description: `Show where the context window goes, and compact from the report: ${CONTEXT_USAGE}`,
		getArgumentCompletions: completeArg,
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (trimmed === "") {
				await openReport(pi, ctx);
				return;
			}
			const [sub = "", ...rest] = trimmed.split(/\s+/);
			if (sub === "compact") {
				compact(ctx, rest.join(" ").trim());
				return;
			}
			ctx.ui.notify(`Unknown /context subcommand "${sub}". Usage: ${CONTEXT_USAGE}`, "warning");
		},
	});
}
