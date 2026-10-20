/**
 * `/check` — run the project's verification command with a live tail and a
 * navigable failure list.
 *
 * The TUI gets the two screens; RPC, print, and JSON run headless and report
 * the summary plus the failure list. The command refuses while plan mode is on
 * because running tests is a write to the project (caches, logs, generated
 * files), and the tool is separately blocked by its annotation.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { isPlanModeEnabled } from "../../lib/plan-state.ts";
import { withRailsSuppressed } from "../../lib/rails.ts";
import { formatCheckReport, formatCheckSummary } from "./format.ts";
import { CheckError, type CheckRuntime } from "./runtime.ts";
import { CheckResultComponent, CheckRunComponent } from "./tui.ts";
import type { CheckResult, CheckTarget } from "./types.ts";

/** The accepted targets and their completion descriptions. */
const TARGETS: ReadonlyArray<{ value: CheckTarget; description: string }> = [
	{ value: "test", description: "Run the test command" },
	{ value: "lint", description: "Run the lint command" },
	{ value: "typecheck", description: "Run the typecheck command" },
	{ value: "all", description: "Run every detected command (default)" },
];

/** Parse one target, or report usage and return undefined. */
function parseTarget(raw: string, ctx: ExtensionCommandContext): CheckTarget | undefined {
	const token = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
	if (token === "") return "all";
	if (TARGETS.some((target) => target.value === token)) return token as CheckTarget;
	ctx.ui.notify(`Unknown check target "${token}". Use test, lint, typecheck, or all.`, "warning");
	return undefined;
}

/** The one-line command summary shown while the process runs. */
function runLabel(commands: readonly string[]): string {
	return commands.length > 0 ? commands.join(" + ") : "check";
}

/** The TUI loop: run, then list/detail, with rerun. */
async function runTui(runtime: CheckRuntime, ctx: ExtensionCommandContext, target: CheckTarget): Promise<void> {
	while (true) {
		let active: ReturnType<CheckRuntime["start"]>;
		try {
			active = runtime.start(target, ctx);
		} catch (error) {
			ctx.ui.notify(error instanceof CheckError ? error.message : String(error), "warning");
			return;
		}

		const result = await ctx.ui.custom<CheckResult | undefined>((tui, theme, _keybindings, done) => {
			const component = new CheckRunComponent({
				command: runLabel(active.commands),
				lines: active.lines,
				elapsedMs: active.elapsedMs,
				theme,
				onCancel: () => active.cancel(),
				requestRender: () => tui.requestRender(),
				viewportRows: () => tui.terminal?.rows,
			});
			active.promise.then(done);
			return component;
		});
		if (!result) return;

		if (result.status === "passed") {
			ctx.ui.notify(formatCheckSummary(result), "info");
			return;
		}
		if (result.status === "cancelled") {
			ctx.ui.notify("Check cancelled.", "info");
			return;
		}
		if (result.status === "error") {
			ctx.ui.notify(formatCheckReport(result), "error");
			return;
		}

		const choice = await ctx.ui.custom<"rerun" | undefined>((tui, theme, _keybindings, done) => {
			const component = new CheckResultComponent({
				result,
				theme,
				onRerun: () => done("rerun"),
				onClose: () => done(undefined),
				requestRender: () => tui.requestRender(),
				viewportRows: () => tui.terminal?.rows,
			});
			return component;
		});
		if (choice !== "rerun") return;
	}
}

export function registerCheckCommand(pi: ExtensionAPI, runtime: CheckRuntime): void {
	pi.registerCommand("check", {
		description: "Run the project's test, lint, or typecheck command and show failures",
		getArgumentCompletions: (prefix) => {
			const trimmed = prefix.trim();
			if (trimmed.includes(" ")) return null;
			const items = TARGETS.filter((target) => target.value.startsWith(trimmed));
			return items.length > 0
				? items.map((target) => ({ label: target.value, value: `${target.value} `, description: target.description }))
				: null;
		},
		handler: async (args, ctx) => {
			if (isPlanModeEnabled(ctx.sessionManager.getBranch())) {
				ctx.ui.notify("Plan mode is read-only. Approve the plan before running checks.", "warning");
				return;
			}
			const target = parseTarget(args, ctx);
			if (!target) return;

			if (ctx.mode !== "tui") {
				const result = await runtime.run(target, ctx);
				ctx.ui.notify(
					result.status === "passed" ? formatCheckSummary(result) : formatCheckReport(result),
					result.status === "error" ? "error" : "info",
				);
				return;
			}

			await withRailsSuppressed(pi, () => runTui(runtime, ctx, target));
		},
	});
}
