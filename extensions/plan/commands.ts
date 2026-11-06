/**
 * Slash command for the plan-mode extension.
 *
 * `/plan` toggles plan mode, or enters it and sends an optional task;
 * Shift+Tab toggles too, through bytefly's editor. One subcommand is reserved:
 * `/plan list` shows the plans directory, newest first with Enter opening a read-only
 * view of one in the browser. Every other line is a task — including `review <path>`,
 * because the browser review is the exit screen's **browser** step, not a command.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRemoteTurn } from "../../lib/interaction.ts";
import { withRailsSuppressed } from "../../lib/rails.ts";
import type { PlanRuntime } from "./runtime.ts";
import type { PlanSummary, StoredPlan } from "./plans.ts";
import { createLazyPlanWebReview, NO_SERVER_DEPS } from "./web-lazy.ts";
import type { PlanWebReview } from "./web.ts";

// One line each way: the mode is already on the composer border and in the footer
// chip, and the read-only guarantee is the `enter` consent question's job (the tool
// result and `docs/extensions/plan.md` restate it), so a toggle does not scroll it.
const ENABLED_NOTICE = "Plan mode enabled — read-only until you approve or leave.";
const DISABLED_NOTICE = "Plan mode disabled — full access restored.";
const LIST_PREFIX = "list";

/** Notice text for the current mode; shared by `/plan` and the toggle request. */
export function planModeNotice(enabled: boolean): string {
	return enabled ? ENABLED_NOTICE : DISABLED_NOTICE;
}

/** Enter plan mode when needed, with the same notice `/plan <task>` shows. */
function ensurePlanMode(runtime: PlanRuntime, ctx: ExtensionContext): void {
	if (runtime.isEnabled()) return;
	runtime.enable(ctx);
	ctx.ui.notify(ENABLED_NOTICE, "info");
}

/**
 * Whether a command line is the reserved `list` subcommand. Exact match only, so
 * `list the untracked files` stays a task instead of silently listing plans.
 */
function isListSubcommand(prompt: string): boolean {
	return prompt.toLowerCase() === LIST_PREFIX;
}

/**
 * The plan a `/plan list` selection names, or undefined after saying why it cannot open.
 *
 * The row carries the path, so there is nothing to fall back to: reading a plan means
 * picking one. A remote turn is refused before the server starts, because the page is
 * served on loopback and a WeChat turn has no browser to drive.
 */
async function planToRead(runtime: PlanRuntime, path: string, ctx: ExtensionContext): Promise<StoredPlan | undefined> {
	const file = await runtime.plans.read(ctx.cwd, path);
	if (!file) {
		ctx.ui.notify(`Plan view: no plan file at ${path}`, "error");
		return undefined;
	}
	if (isRemoteTurn(ctx)) {
		ctx.ui.notify("Plan view: the browser needs the local machine.", "warning");
		return undefined;
	}
	return file;
}

/**
 * Open `planPath` in the browser as a read-only view: the page a review renders, with
 * nothing on it that writes.
 *
 * It returns as soon as the page is up — a view is not a decision, so the turn does not
 * wait for the tab — and the server ends itself when the last tab goes away, or at
 * session shutdown. It deliberately does not mark the review baseline: reading a plan is
 * not reviewing it, and a view that spent the marks would leave the next review with
 * nothing to compare against.
 */
async function viewInBrowser(
	runtime: PlanRuntime,
	web: PlanWebReview,
	planPath: string,
	ctx: ExtensionContext,
): Promise<void> {
	const file = await planToRead(runtime, planPath, ctx);
	if (!file) return;
	const session = await web.start(ctx.cwd, file, { mode: "view" }).catch(() => undefined);
	if (!session) {
		ctx.ui.notify("Plan view: could not start the browser server.", "error");
		return;
	}
	ctx.ui.notify(`Plan view: opened ${session.url}`, "info");
}

/**
 * `/plan list`: show the plans directory, newest first. The TUI gets a docked
 * list whose Enter opens the focused plan in the browser to read; every other
 * mode gets the same facts as a notice, with each plan's path.
 */
async function openPlanIndex(
	pi: ExtensionAPI,
	runtime: PlanRuntime,
	web: PlanWebReview,
	ctx: ExtensionContext,
): Promise<void> {
	const dir = await runtime.plans.dirFor(ctx.cwd);
	// A store an older version kept in the checkout was just moved in; the list is
	// where a user notices their plans are somewhere else.
	const moved = runtime.plans.takeNotice();
	if (moved) ctx.ui.notify(moved, "info");
	const summarise = async (): Promise<Awaited<ReturnType<typeof runtime.plans.index>>> => runtime.plans.index(ctx.cwd);
	const summaries = await summarise();

	if (ctx.mode !== "tui") {
		const { formatPlanIndex } = await import("./plan-index.ts");
		ctx.ui.notify(formatPlanIndex(summaries, dir), "info");
		return;
	}

	// The view runs after the screen closes, so the input focus is free again.
	let selected: (PlanSummary | undefined) | undefined;
	// A dock list shares the editor slot with the goal and todo rails, so it takes
	// the dock to itself for as long as it is open, like the other list screens.
	const { PlanIndexComponent } = await import("./plan-index.ts");
	await withRailsSuppressed(pi, () =>
		ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
			const component = new PlanIndexComponent({
				summaries,
				dir,
				theme,
				onSelect: (summary) => {
					selected = summary;
					done();
				},
				onClose: () => done(),
				reload: summarise,
				requestRender: () => tui.requestRender(),
				viewportRows: () => tui.terminal?.rows,
			});
			return component;
		}),
	);
	if (selected) await viewInBrowser(runtime, web, selected.path, ctx);
}

export function registerCommands(
	pi: ExtensionAPI,
	runtime: PlanRuntime,
	web: PlanWebReview = createLazyPlanWebReview(runtime.plans, NO_SERVER_DEPS),
): void {
	pi.registerCommand("plan", {
		description:
			"Toggle plan mode (read-only exploration), enter it with an optional task, or list saved plans to read one in the browser",
		getArgumentCompletions: (prefix) => {
			const text = prefix.trimStart();
			if (text.includes(" ")) return null;
			const subcommands = [LIST_PREFIX].filter((name) => name.startsWith(text));
			return subcommands.length > 0 ? subcommands.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const prompt = args.trim();

			// `/plan list` is the one reserved subcommand; everything else — `review <path>`
			// included — is a task.
			if (isListSubcommand(prompt)) {
				await openPlanIndex(pi, runtime, web, ctx);
				return;
			}

			// No task: toggle, exactly like Shift+Tab.
			if (!prompt) {
				runtime.toggle(ctx);
				ctx.ui.notify(planModeNotice(runtime.isEnabled()), "info");
				return;
			}

			// A task always means "plan this": enter if needed, then send.
			ensurePlanMode(runtime, ctx);
			if (ctx.isIdle()) await pi.sendUserMessage(prompt);
			else await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});
}
