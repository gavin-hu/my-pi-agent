/**
 * Slash command for the plan-mode extension.
 *
 * `/plan` toggles plan mode, or enters it and sends an optional task;
 * `Ctrl+Alt+P` toggles too. `/plan review [path]` is the one reserved
 * subcommand: it opens the plan in the browser, and when the user saves their
 * comments sends them to the model as a refinement request.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRemoteTurn } from "../../lib/interaction.ts";
import { feedbackSummary } from "./feedback.ts";
import { READ_ONLY_SUMMARY } from "./policy.ts";
import { runBrowserReview } from "./review.ts";
import type { PlanRuntime } from "./runtime.ts";
import { createPlanWebReview, type PlanWebReview } from "./web.ts";

const ENABLED_NOTICE = `Plan mode enabled — ${READ_ONLY_SUMMARY}.`;
const DISABLED_NOTICE = "Plan mode disabled — full access restored.";
const REVIEW_PREFIX = "review";

/** Notice text for the current mode; shared by `/plan` and the `Ctrl+Alt+P` shortcut. */
export function planModeNotice(enabled: boolean): string {
	return enabled ? ENABLED_NOTICE : DISABLED_NOTICE;
}

/** The plan path a `/plan review` line names, or undefined to review the newest plan. */
function reviewTarget(args: string): string | undefined {
	const target = args.slice(REVIEW_PREFIX.length).trim();
	return target === "" ? undefined : target;
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
		if (path) ctx.ui.notify(`plan review: no plan file at ${path}`, "error");
		else ctx.ui.notify("plan review: no plan to review; write one with write_plan or pass a path.", "warning");
		return;
	}
	// The server is loopback-only, so a remote turn cannot drive it.
	if (isRemoteTurn(ctx)) {
		ctx.ui.notify("plan review: browser review needs the local machine.", "warning");
		return;
	}

	const previous = runtime.reviewed(file.path);
	const result = await runBrowserReview(web, ctx.cwd, file, {
		canApprove: false,
		previous,
		// Mark only once the page is actually open: a failed start must not consume
		// the baseline for a plan nobody saw.
		onOpened: (session) => {
			runtime.markReviewed(file.path, file.content);
			ctx.ui.notify(`plan review: opened ${session.url}`, "info");
		},
	});
	if (!result) {
		ctx.ui.notify("plan review: could not start the browser review server.", "error");
		return;
	}

	if (result.status === "cancelled") {
		ctx.ui.notify("plan review: closed without saving.", "info");
		return;
	}
	const summary = feedbackSummary(result.annotations);
	if (!summary) {
		ctx.ui.notify("plan review: saved with no comments.", "info");
		return;
	}
	const message = runtime.isEnabled()
		? `The user reviewed the plan ${result.plan.relativePath} in the browser and left feedback:\n${summary}\nStay in plan mode, revise the plan (write_plan, reusing plan_path), then call exit_plan_mode again.`
		: `The user reviewed the plan ${result.plan.relativePath} in the browser and left feedback:\n${summary}\nUpdate the plan file to address the feedback.`;
	if (ctx.isIdle()) await pi.sendUserMessage(message);
	else await pi.sendUserMessage(message, { deliverAs: "followUp" });
}

export function registerCommands(
	pi: ExtensionAPI,
	runtime: PlanRuntime,
	web: PlanWebReview = createPlanWebReview(runtime.plans),
): void {
	pi.registerCommand("plan", {
		description:
			"Toggle plan mode (read-only exploration), enter it with an optional task, or review a plan in the browser",
		getArgumentCompletions: (prefix) => {
			const text = prefix.trimStart();
			if (text.includes(" ")) return null;
			return REVIEW_PREFIX.startsWith(text) ? [{ value: REVIEW_PREFIX, label: REVIEW_PREFIX }] : null;
		},
		handler: async (args, ctx) => {
			const prompt = args.trim();

			// `/plan review [path]` is a reserved subcommand; everything else is a task.
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
			if (!runtime.isEnabled()) {
				runtime.enable(ctx);
				ctx.ui.notify(ENABLED_NOTICE, "info");
			}
			if (ctx.isIdle()) await pi.sendUserMessage(prompt);
			else await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});
}
