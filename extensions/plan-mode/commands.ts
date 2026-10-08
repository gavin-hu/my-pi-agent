/**
 * Slash commands for the plan-mode extension.
 *
 * `/plan` toggles plan mode, or enters it and sends an optional task;
 * `Ctrl+Alt+P` toggles too. `/plans` opens the plan browser in the TUI, or
 * prints the saved plans elsewhere. All management happens in the browser:
 * Enter reads, `d` deletes, `u` uses, Esc closes.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { withRailsSuppressed } from "../_shared/rails.ts";
import { FULL_SCREEN_OVERLAY } from "../_shared/tui.ts";
import type { PlanSummary, StoredPlan } from "./plans.ts";
import { READ_ONLY_SUMMARY } from "./policy.ts";
import type { PlanRuntime } from "./runtime.ts";
import { PlanListComponent, type PlanListAction } from "./list-tui.ts";
import { PlanViewComponent } from "./tui.ts";

const ENABLED_NOTICE = `Plan mode enabled — ${READ_ONLY_SUMMARY}.`;
const DISABLED_NOTICE = "Plan mode disabled — full access restored.";

/** Old `/plan list|show|delete` words; `/plan` now toggles plan mode. */
const LEGACY_SUBCOMMANDS = ["list", "show", "delete", "use"] as const;

/** Lines of a plan shown in an unstructured (non-TUI) notice. */
const PREVIEW_LINES = 40;

/** Notice text for the current mode; shared by `/plan` and the `Ctrl+Alt+P` shortcut. */
export function planModeNotice(enabled: boolean): string {
	return enabled ? ENABLED_NOTICE : DISABLED_NOTICE;
}

/** Bounded text for a plan shown outside the TUI. */
function previewPlan(content: string): string {
	const lines = content.split("\n");
	if (lines.length <= PREVIEW_LINES) return content;
	return [...lines.slice(0, PREVIEW_LINES), `… ${lines.length - PREVIEW_LINES} more lines`].join("\n");
}

/** List saved plans as a plain notice (headless/RPC). */
function printPlans(ctx: ExtensionCommandContext, plans: PlanSummary[]): void {
	if (plans.length === 0) {
		ctx.ui.notify("No plans yet. Write one with write_plan while planning.", "info");
		return;
	}
	const lines = [`${plans.length} plan${plans.length === 1 ? "" : "s"} (newest first):`];
	for (const plan of plans) {
		lines.push(`  ${plan.title} · ${plan.steps} step${plan.steps === 1 ? "" : "s"} · ${plan.relativePath}`);
	}
	ctx.ui.notify(lines.join("\n"), "info");
}

/** Open one plan read-only: the browse screen in the TUI, a bounded notice otherwise. */
async function browsePlan(ctx: ExtensionCommandContext, plan: StoredPlan): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify(`${plan.relativePath}\n\n${previewPlan(plan.content)}`, "info");
		return;
	}
	await ctx.ui.custom<undefined>(
		(tui, theme, _keybindings, done) =>
			new PlanViewComponent({
				plan,
				theme,
				mode: "browse",
				onClose: () => done(undefined),
				requestRender: () => tui.requestRender(),
				viewportRows: () => tui.terminal?.rows,
			}),
		FULL_SCREEN_OVERLAY,
	);
}

/** Pick a plan from the TUI browser; undefined closes the menu. */
async function choosePlan(
	ctx: ExtensionCommandContext,
	plans: PlanSummary[],
	activePlanPath?: string,
): Promise<PlanListAction | undefined> {
	return ctx.ui.custom<PlanListAction | undefined>(
		(tui, theme, _keybindings, done) =>
			new PlanListComponent({
				plans,
				theme,
				activePlanPath,
				onClose: (action) => done(action),
				requestRender: () => tui.requestRender(),
				viewportRows: () => tui.terminal?.rows,
			}),
	);
}

/** Confirm and hand a saved plan back to the model to execute (normal mode). */
async function usePlan(pi: ExtensionAPI, ctx: ExtensionCommandContext, plan: PlanSummary): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Executing a plan needs an interactive UI to confirm.", "warning");
		return;
	}
	const approved = await ctx.ui.confirm(
		"Execute this plan?",
		`${plan.relativePath}\nThe model will read the plan file and execute its steps in normal mode.`,
	);
	if (!approved) return;
	const message =
		`Execute the plan in ${plan.path}. Read it first, then carry out its steps, ` +
		"keeping the plan file as the source of truth.";
	if (ctx.isIdle()) await pi.sendUserMessage(message);
	else await pi.sendUserMessage(message, { deliverAs: "followUp" });
}

/** The TUI browser behind `/plans`. View and delete keep it open; use closes it. */
async function openPlansMenu(pi: ExtensionAPI, runtime: PlanRuntime, ctx: ExtensionCommandContext): Promise<void> {
	for (;;) {
		const plans = await runtime.plans.list(ctx.cwd);
		const choice = await choosePlan(ctx, plans, runtime.lastPlanPath());
		if (!choice) return;

		if (choice.action === "view") {
			const plan = await runtime.plans.read(ctx.cwd, choice.plan.path);
			if (!plan) {
				ctx.ui.notify(`Plan not found: ${choice.plan.relativePath}`, "warning");
				continue;
			}
			await browsePlan(ctx, plan);
			continue;
		}

		if (choice.action === "delete") {
			const approved = await ctx.ui.confirm(
				"Delete this plan?",
				`${choice.plan.relativePath}\nThis removes the file from the plans directory; it cannot be undone.`,
			);
			if (!approved) continue;
			const removed = await runtime.plans.remove(ctx.cwd, choice.plan.path);
			ctx.ui.notify(
				removed ? `Deleted ${choice.plan.relativePath}.` : `Could not delete ${choice.plan.relativePath}.`,
				removed ? "info" : "warning",
			);
			continue;
		}

		await usePlan(pi, ctx, choice.plan);
		return;
	}
}

export function registerCommands(pi: ExtensionAPI, runtime: PlanRuntime): void {
	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration), or enter it with an optional task",
		handler: async (args, ctx) => {
			const prompt = args.trim();
			const first = prompt.split(/\s+/)[0];
			// `/plan list` and friends used to manage plans; point them at `/plans`
			// instead of silently planning a task named "list".
			if (prompt && (LEGACY_SUBCOMMANDS as readonly string[]).includes(first)) {
				ctx.ui.notify("Plan management moved to /plans.", "info");
				return;
			}

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

	pi.registerCommand("plans", {
		description: "Browse and manage saved plans",
		handler: async (_args, ctx) => {
			if (ctx.mode === "tui") await withRailsSuppressed(pi, () => openPlansMenu(pi, runtime, ctx));
			else printPlans(ctx, await runtime.plans.list(ctx.cwd));
		},
	});
}
