/**
 * Slash commands for the plan-mode extension.
 *
 * `/plan` toggles plan mode, or enters it and sends the rest of the line as the
 * task. `list`, `show`, and `delete` are reserved first arguments that manage
 * saved plan files instead:
 *
 *   /plan                  toggle plan mode
 *   /plan <prompt>         enter plan mode and send the task
 *   /plan list             open the TUI browser (print the list elsewhere)
 *   /plan show <file>      open one saved plan in the review screen (browse)
 *   /plan delete <file>    confirm and delete one saved plan
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { PlanSummary, StoredPlan } from "./plans.ts";
import { READ_ONLY_SUMMARY } from "./policy.ts";
import type { PlanRuntime } from "./runtime.ts";
import { PlanListComponent, type PlanListAction } from "./list-tui.ts";
import { PlanReviewComponent } from "./tui.ts";

const ENABLED_NOTICE = `Plan mode enabled — ${READ_ONLY_SUMMARY}.`;
const DISABLED_NOTICE = "Plan mode disabled — full access restored.";

/** Reserved first arguments; anything else is a task prompt. */
const SUBCOMMANDS = ["list", "show", "delete"] as const;
type PlanSubcommand = (typeof SUBCOMMANDS)[number];

/** Lines of a plan shown in an unstructured (non-TUI) notice. */
const PREVIEW_LINES = 40;

interface Completion {
	value: string;
	label: string;
	description?: string;
}

const SUBCOMMAND_ITEMS: Completion[] = [
	{ value: "list", label: "list", description: "List saved plans, or open the browser" },
	{ value: "show", label: "show", description: "View a saved plan: show <file>" },
	{ value: "delete", label: "delete", description: "Delete a saved plan: delete <file>" },
];

/** Notice text for the current mode; shared by `/plan` and the `Ctrl+Alt+P` shortcut. */
export function planModeNotice(enabled: boolean): string {
	return enabled ? ENABLED_NOTICE : DISABLED_NOTICE;
}

/** Split `/plan` arguments into a reserved subcommand + rest, or a task prompt. */
function parsePlanArgs(raw: string):
	| { kind: "subcommand"; subcommand: PlanSubcommand; rest: string }
	| { kind: "prompt"; prompt: string } {
	const trimmed = raw.trim();
	if (!trimmed) return { kind: "prompt", prompt: "" };
	const [first, ...rest] = trimmed.split(/\s+/);
	if ((SUBCOMMANDS as readonly string[]).includes(first)) {
		return { kind: "subcommand", subcommand: first as PlanSubcommand, rest: rest.join(" ").trim() };
	}
	return { kind: "prompt", prompt: trimmed };
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
	await ctx.ui.custom<undefined>((tui, theme, _keybindings, done) =>
		new PlanReviewComponent({
			plan,
			theme,
			mode: "browse",
			onClose: () => done(undefined),
			requestRender: () => tui.requestRender(),
			viewportRows: () => tui.terminal?.rows,
		}),
	);
}

/** Pick a plan from the browser or a select; undefined closes the menu. */
async function choosePlan(ctx: ExtensionCommandContext, plans: PlanSummary[]): Promise<PlanListAction | undefined> {
	if (plans.length === 0) return undefined;
	if (ctx.mode === "tui") {
		return ctx.ui.custom<PlanListAction | undefined>((tui, theme, _keybindings, done) =>
			new PlanListComponent({
				plans,
				theme,
				onClose: (action) => done(action),
				requestRender: () => tui.requestRender(),
				viewportRows: () => tui.terminal?.rows,
			}),
		);
	}
	if (!ctx.hasUI || plans.length === 1) return { action: "view", plan: plans[0] };
	const labels = plans.map((plan) => `${plan.title} · ${plan.steps} steps`);
	const chosen = await ctx.ui.select("Open which plan?", labels);
	if (!chosen) return undefined;
	return { action: "view", plan: plans[labels.indexOf(chosen)] };
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

/** The interactive browser behind `/plan list`. View and delete keep it open; use closes it. */
async function openPlansMenu(pi: ExtensionAPI, runtime: PlanRuntime, ctx: ExtensionCommandContext): Promise<void> {
	for (;;) {
		const plans = await runtime.plans.list(ctx.cwd);
		const choice = await choosePlan(ctx, plans);
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

/** `/plan show <file>` and `/plan delete <file>`. */
async function manageFile(
	runtime: PlanRuntime,
	ctx: ExtensionCommandContext,
	subcommand: "show" | "delete",
	argument: string,
): Promise<void> {
	if (!argument) {
		ctx.ui.notify(`Usage: /plan ${subcommand} <plan-file>`, "warning");
		return;
	}
	const plan = await runtime.plans.read(ctx.cwd, argument);
	if (!plan) {
		ctx.ui.notify(`Plan not found: ${argument}`, "warning");
		return;
	}
	if (subcommand === "show") {
		await browsePlan(ctx, plan);
		return;
	}
	if (!ctx.hasUI) {
		ctx.ui.notify("Deleting a plan needs an interactive UI to confirm.", "warning");
		return;
	}
	const approved = await ctx.ui.confirm(
		"Delete this plan?",
		`${plan.relativePath}\nThis removes the file from the plans directory; it cannot be undone.`,
	);
	if (!approved) return;
	const removed = await runtime.plans.remove(ctx.cwd, plan.path);
	ctx.ui.notify(removed ? `Deleted ${plan.relativePath}.` : `Could not delete ${plan.relativePath}.`, removed ? "info" : "warning");
}

export function registerCommands(pi: ExtensionAPI, runtime: PlanRuntime): void {
	pi.registerCommand("plan", {
		description: "Toggle plan mode, plan a task, or manage saved plans: /plan [prompt|list|show|delete]",
		getArgumentCompletions: (prefix) => {
			const [action = "", argument] = prefix.trimStart().split(/\s+/);
			if (argument !== undefined) return null;
			const items = SUBCOMMAND_ITEMS.filter((item) => item.value.startsWith(action));
			return items.length > 0 ? items.map((item) => ({ ...item, value: `${item.value} ` })) : null;
		},
		handler: async (args, ctx) => {
			const parsed = parsePlanArgs(args);

			if (parsed.kind === "subcommand") {
				if (parsed.subcommand === "list") {
					if (ctx.mode === "tui") await openPlansMenu(pi, runtime, ctx);
					else printPlans(ctx, await runtime.plans.list(ctx.cwd));
					return;
				}
				await manageFile(runtime, ctx, parsed.subcommand, parsed.rest);
				return;
			}

			const prompt = parsed.prompt;

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
			if (ctx.isIdle()) await pi.sendUserMessage(prompt);
			else await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});
}
