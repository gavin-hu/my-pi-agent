/**
 * Slash command for the plan-mode extension.
 *
 * `/plan` toggles plan mode, or enters it and sends an optional task;
 * `Ctrl+Alt+P` toggles too. Two subcommands are reserved: `/plan review [path]`
 * opens a plan in the browser (and sends saved comments to the model as a
 * refinement), and `/plan list` shows the plans directory, newest first, with
 * Enter opening a review.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRemoteTurn } from "../../lib/interaction.ts";
import { READ_ONLY_SUMMARY } from "../../lib/plan-entry.ts";
import { feedbackSummary } from "./feedback.ts";
import { PlanIndexComponent, formatPlanIndex } from "./plan-index.ts";
import { runBrowserReview } from "./review.ts";
import type { PlanRuntime } from "./runtime.ts";
import type { PlanSummary } from "./plans.ts";
import { createPlanWebReview, type PlanWebReview } from "./web.ts";

const ENABLED_NOTICE = `Plan mode enabled — ${READ_ONLY_SUMMARY}.`;
const DISABLED_NOTICE = "Plan mode disabled — full access restored.";
const REVIEW_PREFIX = "review";
const LIST_PREFIX = "list";
const CANCEL_PREFIX = "cancel";

/** Notice text for the current mode; shared by `/plan` and the `Ctrl+Alt+P` shortcut. */
export function planModeNotice(enabled: boolean): string {
	return enabled ? ENABLED_NOTICE : DISABLED_NOTICE;
}

/** Enter plan mode when needed, with the same notice `/plan <task>` shows. */
function ensurePlanMode(runtime: PlanRuntime, ctx: ExtensionContext): void {
	if (runtime.isEnabled()) return;
	runtime.enable(ctx);
	ctx.ui.notify(ENABLED_NOTICE, "info");
}

/** The plan path a `/plan review` line names, or undefined to review the newest plan. */
function reviewTarget(args: string): string | undefined {
	const target = args.slice(REVIEW_PREFIX.length).trim();
	return target === "" ? undefined : target;
}

/**
 * Whether a command line is the reserved `list` subcommand. Exact match only, so
 * `list the untracked files` stays a task instead of silently listing plans.
 */
function isListSubcommand(prompt: string): boolean {
	return prompt.toLowerCase() === LIST_PREFIX;
}

/** Exact `cancel` leaves plan mode without approving; a longer sentence stays a task. */
function isCancelSubcommand(prompt: string): boolean {
	return prompt.toLowerCase() === CANCEL_PREFIX;
}

/**
 * Whether a command line is the reserved `review` subcommand. Bare `review`
 * always is; a path after it is, but `review the auth flow` stays a task, so a
 * task that begins with the word "review" is not silently hijacked.
 */
function isReviewSubcommand(prompt: string): boolean {
	if (prompt === REVIEW_PREFIX) return true;
	if (!prompt.startsWith(`${REVIEW_PREFIX} `)) return false;
	const target = prompt.slice(REVIEW_PREFIX.length).trim();
	return target.endsWith(".md") || target.includes("/") || target.includes("\\");
}

/**
 * Open `planPath` in the browser and, if the user saves comments, hand them to
 * the model. A cancel is silent beyond a notice; nothing is sent.
 */
async function reviewInBrowser(
	pi: ExtensionAPI,
	runtime: PlanRuntime,
	web: PlanWebReview,
	planPath: string | undefined,
	ctx: ExtensionContext,
): Promise<void> {
	const path = planPath ?? runtime.lastPlanPath();
	// A bare `/plan review` in a later session has no remembered path, so fall back
	// to the newest plan file in the plans directory.
	const file = path ? await runtime.plans.read(ctx.cwd, path) : await runtime.plans.latest(ctx.cwd);
	if (!file) {
		if (path) ctx.ui.notify(`Plan review: no plan file at ${path}`, "error");
		else ctx.ui.notify("Plan review: no plan to review; write one with write_plan or pass a path.", "warning");
		return;
	}
	// The server is loopback-only, so a remote turn cannot drive it.
	if (isRemoteTurn(ctx)) {
		ctx.ui.notify("Plan review: browser review needs the local machine.", "warning");
		return;
	}

	const baseline = runtime.reviewed(file.path);
	const result = await runBrowserReview(web, ctx.cwd, file, {
		canApprove: false,
		baseline,
		// Mark only once the page is actually open: a failed start must not consume
		// the baseline for a plan nobody saw.
		onOpened: (session) => {
			runtime.markReviewed(file.path, file.content);
			ctx.ui.notify(`Plan review: opened ${session.url}`, "info");
		},
	});
	if (!result) {
		ctx.ui.notify("Plan review: could not start the browser review server.", "error");
		return;
	}

	if (result.status === "cancelled") {
		ctx.ui.notify("Plan review: closed without saving.", "info");
		return;
	}
	const summary = feedbackSummary(result.annotations);
	if (!summary) {
		ctx.ui.notify("Plan review: saved with no comments.", "info");
		return;
	}
	const message = runtime.isEnabled()
		? `The user reviewed the plan ${result.plan.relativePath} in the browser and left feedback:\n${summary}\nStay in plan mode, revise the plan (write_plan, reusing plan_path), then call exit_plan_mode again.`
		: `The user reviewed the plan ${result.plan.relativePath} in the browser and left feedback:\n${summary}\nUpdate the plan file to address the feedback.`;
	if (ctx.isIdle()) await pi.sendUserMessage(message);
	else await pi.sendUserMessage(message, { deliverAs: "followUp" });
}

/**
 * `/plan list`: show the plans directory, newest first. The TUI gets a docked
 * list whose Enter opens the focused plan's review; every other mode gets the
 * same facts as a notice, with each plan's path.
 */
async function openPlanIndex(
	pi: ExtensionAPI,
	runtime: PlanRuntime,
	web: PlanWebReview,
	ctx: ExtensionContext,
): Promise<void> {
	const dir = await runtime.plans.dirFor(ctx.cwd);
	const summarise = async (): Promise<Awaited<ReturnType<typeof runtime.plans.index>>> => runtime.plans.index(ctx.cwd);
	const summaries = await summarise();

	if (ctx.mode !== "tui") {
		ctx.ui.notify(formatPlanIndex(summaries, dir), "info");
		return;
	}

	// The review runs after the screen closes, so the input focus is free again.
	let selected: (PlanSummary | undefined) | undefined;
	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
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
	});
	if (selected) await reviewInBrowser(pi, runtime, web, selected.path, ctx);
}

export function registerCommands(
	pi: ExtensionAPI,
	runtime: PlanRuntime,
	web: PlanWebReview = createPlanWebReview(runtime.plans),
): void {
	pi.registerCommand("plan", {
		description:
			"Toggle plan mode (read-only exploration), enter it with an optional task, list saved plans, review one in the browser, or cancel planning without approving",
		getArgumentCompletions: (prefix) => {
			const text = prefix.trimStart();
			if (text.includes(" ")) return null;
			const subcommands = [LIST_PREFIX, REVIEW_PREFIX, CANCEL_PREFIX].filter((name) => name.startsWith(text));
			return subcommands.length > 0 ? subcommands.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const prompt = args.trim();

			// `/plan list`, `/plan review [path]`, and `/plan cancel` are reserved
			// subcommands; everything else is a task.
			if (isCancelSubcommand(prompt)) {
				if (!runtime.isEnabled()) {
					ctx.ui.notify("Plan mode is already off.", "info");
					return;
				}
				runtime.disable(ctx);
				ctx.ui.notify("Plan mode off — full access restored. The plan was not approved.", "info");
				return;
			}
			if (isListSubcommand(prompt)) {
				await openPlanIndex(pi, runtime, web, ctx);
				return;
			}
			if (isReviewSubcommand(prompt)) {
				await reviewInBrowser(pi, runtime, web, reviewTarget(prompt), ctx);
				return;
			}

			// No task: toggle, exactly like Ctrl+Alt+P.
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
