/**
 * Slash command for the plan-mode extension.
 *
 * `/plan` toggles plan mode, or enters it and sends an optional task;
 * Shift+Tab toggles too, through bytefly's editor. Two subcommands are reserved:
 * `/plan review [path]` opens a plan in the browser to comment on it (and sends saved
 * comments to the model as a refinement), and `/plan list` shows the plans directory,
 * newest first with Enter opening a read-only view of one. Every other line is a task.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRemoteTurn } from "../../lib/interaction.ts";
import { withRailsSuppressed } from "../../lib/rails.ts";
import { feedbackSummary } from "./feedback.ts";
import { runBrowserReview } from "./review-lazy.ts";
import type { PlanRuntime } from "./runtime.ts";
import type { PlanSummary, StoredPlan } from "./plans.ts";
import { createLazyPlanWebReview, NO_SERVER_DEPS } from "./web-lazy.ts";
import type { PlanWebReview } from "./web.ts";

// One line each way: the mode is already on the composer border and in the footer
// chip, and the read-only guarantee is the `enter` consent question's job (the tool
// result and `docs/extensions/plan.md` restate it), so a toggle does not scroll it.
const ENABLED_NOTICE = "Plan mode enabled — read-only until you approve or leave.";
const DISABLED_NOTICE = "Plan mode disabled — full access restored.";
const REVIEW_PREFIX = "review";
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

/** The word a browser door is called by, in its own notices. */
type BrowserDoor = "review" | "view";

/**
 * The plan a browser door should open, or undefined after saying why it cannot.
 *
 * Both doors take a path, fall back to the plan this session wrote, then to the newest
 * one on disk, and both refuse a remote turn: the page is served on loopback, so a WeChat
 * turn has no browser to drive.
 */
async function planForBrowser(
	runtime: PlanRuntime,
	planPath: string | undefined,
	ctx: ExtensionContext,
	door: BrowserDoor,
): Promise<StoredPlan | undefined> {
	const path = planPath ?? runtime.lastPlanPath();
	// A bare `/plan review` in a later session has no remembered path, so fall back
	// to the newest plan file in the plans directory.
	const file = path ? await runtime.plans.read(ctx.cwd, path) : await runtime.plans.latest(ctx.cwd);
	if (!file) {
		if (path) ctx.ui.notify(`Plan ${door}: no plan file at ${path}`, "error");
		else
			ctx.ui.notify(
				`Plan ${door}: no plan to ${door}; write one with \`plan\` action \`write\` or pass a path.`,
				"warning",
			);
		return undefined;
	}
	// The server is loopback-only, so a remote turn cannot drive it.
	if (isRemoteTurn(ctx)) {
		ctx.ui.notify(`Plan ${door}: the browser needs the local machine.`, "warning");
		return undefined;
	}
	return file;
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
	const file = await planForBrowser(runtime, planPath, ctx, "review");
	if (!file) return;

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
		? `The user reviewed the plan ${result.plan.relativePath} in the browser and left feedback:\n${summary}\nStay in plan mode, revise the plan (\`plan\` action \`write\`, reusing plan_path), then call \`plan\` action \`exit\` again.`
		: `The user reviewed the plan ${result.plan.relativePath} in the browser and left feedback:\n${summary}\nUpdate the plan file to address the feedback.`;
	if (ctx.isIdle()) await pi.sendUserMessage(message);
	else await pi.sendUserMessage(message, { deliverAs: "followUp" });
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
	planPath: string | undefined,
	ctx: ExtensionContext,
): Promise<void> {
	const file = await planForBrowser(runtime, planPath, ctx, "view");
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
			"Toggle plan mode (read-only exploration), enter it with an optional task, list saved plans, read one in the browser, or review one to comment on it",
		getArgumentCompletions: (prefix) => {
			const text = prefix.trimStart();
			if (text.includes(" ")) return null;
			const subcommands = [LIST_PREFIX, REVIEW_PREFIX].filter((name) => name.startsWith(text));
			return subcommands.length > 0 ? subcommands.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const prompt = args.trim();

			// `/plan list` and `/plan review [path]` are the reserved subcommands;
			// everything else is a task.
			if (isListSubcommand(prompt)) {
				await openPlanIndex(pi, runtime, web, ctx);
				return;
			}
			if (isReviewSubcommand(prompt)) {
				await reviewInBrowser(pi, runtime, web, reviewTarget(prompt), ctx);
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
