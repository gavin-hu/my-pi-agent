/**
 * The plan review gate: ask the human about a plan file and return one decision.
 *
 * A review has three presentations — the scrollable TUI screen, a select plus
 * editor for dialog-only modes, and a remote turn's plan file plus digest — and
 * one optional browser server. This module owns the loop that switches between
 * them, so `exit_plan_mode` and `/plan review` share one lifecycle and only map
 * the returned {@link ReviewDecision} to their own result.
 *
 * It also owns the review baseline: a review marks the content the human was
 * actually shown, never content that was only about to be shown, and the abort
 * signal reaches the browser server so an aborted turn closes it.
 */

import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import { askHuman } from "../../lib/interaction.ts";
import { FULL_SCREEN_OVERLAY } from "../../lib/tui/chrome.ts";
import { feedbackSummary, type PlanAnnotation } from "./feedback.ts";
import type { PlanStore, StoredPlan } from "./plans.ts";
import type { SectionDigest } from "./plan-text.ts";
import { extractPlanSteps } from "./steps.ts";
import { PlanViewComponent, type PlanViewAction } from "./tui.ts";
import type { PlanReviewResult, PlanReviewSession, PlanWebReview } from "./web.ts";

/** A choice from the review screen, with the refinement the screen carried, if any. */
interface PlanReviewChoice {
	action: PlanViewAction;
	refinement?: string;
}

/** A dialog-only choice: post the full plan text, then ask again. Never returned. */
type ReviewChoice = PlanReviewChoice | { action: "send" };

/** What a review decided, and the plan state it decided on. */
export type ReviewDecision =
	| { action: "approve"; plan: StoredPlan; comments: PlanAnnotation[] }
	| {
			action: "refine";
			plan: StoredPlan;
			/** The refinement request: the saved comments, or what the user typed. */
			refinement: string;
			comments: PlanAnnotation[];
			/** True when the request came from the browser, which is reported differently. */
			fromBrowser: boolean;
	  }
	| { action: "keep"; plan: StoredPlan }
	/** Leave plan mode without approving; the plan file stays for a later review. */
	| { action: "cancel"; plan: StoredPlan };

/** What the previous review showed, so this one can mark what changed. */
export interface ReviewBaselines {
	/** The sections the last review of `path` showed, when this branch has one. */
	reviewed(path: string): SectionDigest[] | undefined;
	/** Remember what a review just showed, as a session entry on this branch. */
	markReviewed(path: string, content: string): void;
}

/** Everything one review needs: whom to ask, where to ask, and what to compare against. */
export interface ReviewPlanOptions {
	ctx: ExtensionToolContext;
	web: PlanWebReview;
	/** Re-read the plan after a browser review that may have changed it. */
	plans: Pick<PlanStore, "read">;
	baselines: ReviewBaselines;
	plan: StoredPlan;
	/** Aborting the turn closes a browser review and returns the plan unapproved. */
	signal?: AbortSignal;
}

/** Prompt shown by the dialog-based refine editor in non-TUI modes. */
const REFINE_PROMPT = "Refine the plan — what should change? (Enter to save, Esc to cancel)";

/** How much of one step the remote digest shows. */
const DIGEST_STEP_CHARS = 90;

/** The refinement request used when a browser save carried no comments. */
const NO_BROWSER_COMMENTS = "See the review comments in the plan file.";

/**
 * A one-message digest of the plan for a remote review.
 *
 * The file is the primary artifact, but a phone client may never render or open
 * it, and the peer still has to choose approve / refine. The digest carries the
 * title, the step count, and the first few steps; the full text follows as a
 * file or as the fallback message.
 */
function planReviewDigest(content: string): string {
	const title = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
	const steps = extractPlanSteps(content);
	const count = steps.length;
	const head = `Plan${title ? `: ${title}` : ""}${count > 0 ? ` (${count} step${count === 1 ? "" : "s"})` : ""}`;
	const preview = steps.slice(0, 3).map((step, index) => {
		const text = step.content.replace(/\s+/g, " ").trim();
		const shown = text.length > DIGEST_STEP_CHARS ? `${text.slice(0, DIGEST_STEP_CHARS - 1)}…` : text;
		return `${index + 1}. ${shown}`;
	});
	const more = count > preview.length ? `… (${count - preview.length} more)` : "";
	return [
		head,
		...preview,
		more,
		"Plan mode is on — write access is off. Choose “Exit plan mode” to leave without approving.",
		"The full plan is attached above, or sent as text if the file failed.",
	]
		.filter((line) => line !== "")
		.join("\n");
}

/**
 * Ask the user to review the plan file. The TUI opens the scrollable review
 * screen (with an inline refine editor); dialog-capable modes (RPC) fall back to
 * a select plus the refine editor; a remote turn gets the plan file and a digest
 * first. Asking for the full plan re-enters with the text only, then shows the
 * choices again.
 */
async function askPlanReview(
	ctx: ExtensionToolContext,
	plan: StoredPlan,
	baseline: SectionDigest[] | undefined,
): Promise<PlanReviewChoice> {
	let sentFullText = false;
	for (;;) {
		const outcome = await askHuman<ReviewChoice>(ctx, {
			custom: async () => {
				const choice = await ctx.ui.custom<PlanReviewChoice | undefined>(
					(tui, theme, _keybindings, done) =>
						new PlanViewComponent({
							plan,
							baseline,
							theme,
							onClose: (action, refinement) => done({ action, refinement }),
							requestRender: () => tui.requestRender(),
							viewportRows: () => tui.terminal?.rows,
							tui,
						}),
					FULL_SCREEN_OVERLAY,
				);
				return choice ?? { action: "keep" };
			},
			dialogs: async () => {
				const choice = await ctx.ui.select("Plan mode — what next?", [
					"Approve and execute",
					"Send the full plan",
					"Refine the plan",
					"Keep planning (stay in plan mode)",
					"Exit plan mode (discard)",
				]);
				if (choice === "Approve and execute") return { action: "approve" };
				if (choice === "Send the full plan") return { action: "send" };
				if (choice === "Refine the plan") return { action: "refine" };
				if (choice === "Keep planning (stay in plan mode)") return { action: "keep" };
				// Dismissing the plan gate means leaving plan mode, not silently staying
				// in it. The explicit Keep choice above is the only way to stay.
				return { action: "cancel" };
			},
			// A remote turn gets the plan file up front, falling back to the full text;
			// a local TUI turn ignores both and renders the component. The digest goes
			// out either way so the choices stay answerable when a phone client does not
			// render the file bubble.
			file: sentFullText ? undefined : { path: plan.path, name: basename(plan.relativePath) },
			body: plan.content,
			note: sentFullText ? undefined : planReviewDigest(plan.content),
		});
		if (outcome.action !== "send") return outcome;
		sentFullText = true;
	}
}

/** How a browser review may decide, and what to report when it opens. */
export interface BrowserReviewOptions {
	/** Whether the browser may approve the plan (only the `exit_plan_mode` flow). */
	canApprove: boolean;
	/** The section digests the previous review showed, for the changed markers. */
	baseline?: SectionDigest[];
	/** Aborting the turn closes the session as cancelled. */
	signal?: AbortSignal;
	/** Called once the server is listening and the browser was opened. */
	onOpened?: (session: PlanReviewSession) => void;
}

/**
 * Open a browser review and wait for its outcome. `undefined` means the server
 * could not start, so the caller can fall back to the screen it came from.
 */
export async function runBrowserReview(
	web: PlanWebReview,
	cwd: string,
	plan: StoredPlan,
	options: BrowserReviewOptions,
): Promise<PlanReviewResult | undefined> {
	if (options.signal?.aborted) return { status: "cancelled" };
	const session = await web
		.start(cwd, plan, { canApprove: options.canApprove, baseline: options.baseline, signal: options.signal })
		.catch(() => undefined);
	if (!session) return undefined;
	options.onOpened?.(session);
	try {
		return await session.done;
	} finally {
		await session.close();
	}
}

/**
 * Ask the user about `plan` and return the decision. Approve and keep end the
 * review; a refinement is handed back to the model; a browser review that is
 * cancelled returns to the screen it was opened from.
 */
export async function reviewPlan(options: ReviewPlanOptions): Promise<ReviewDecision> {
	const { ctx, web, plans, baselines, signal } = options;
	let plan = options.plan;
	for (;;) {
		// An aborted turn has nobody left to answer the screen.
		if (signal?.aborted) return { action: "keep", plan };
		// Read the baseline before the screen and mark it after, so what the next
		// review compares against is the content this one actually showed.
		const baseline = baselines.reviewed(plan.path);
		const choice = await askPlanReview(ctx, plan, baseline);
		baselines.markReviewed(plan.path, plan.content);

		if (choice.action === "approve") return { action: "approve", plan, comments: [] };
		if (choice.action === "keep") return { action: "keep", plan };
		if (choice.action === "cancel") return { action: "cancel", plan };
		if (choice.action === "refine") {
			const refinement = choice.refinement ?? (await ctx.ui.editor(REFINE_PROMPT, ""))?.trim();
			// An empty or cancelled editor returns to the review screen instead of
			// being reported as "not approved".
			if (!refinement) continue;
			return { action: "refine", plan, refinement, comments: [], fromBrowser: false };
		}
		// An unrecognized action keeps planning rather than opening a server.
		if (choice.action !== "browser") return { action: "keep", plan };

		const result = await runBrowserReview(web, ctx.cwd, plan, {
			canApprove: true,
			baseline,
			signal,
			onOpened: (session) => ctx.ui.notify(`Plan review: opened ${session.url}`, "info"),
		});
		if (!result) {
			ctx.ui.notify("Plan review: could not start the browser review server.", "error");
			continue;
		}
		if (result.status === "approved") return { action: "approve", plan: result.plan, comments: result.annotations };
		if (result.status === "saved") {
			return {
				action: "refine",
				plan: result.plan,
				refinement: feedbackSummary(result.annotations) || NO_BROWSER_COMMENTS,
				comments: result.annotations,
				fromBrowser: true,
			};
		}
		// Cancelled or the tab closed: the file may have been rewritten underneath,
		// so re-read it before showing the screen again.
		plan = (await plans.read(ctx.cwd, plan.path)) ?? plan;
	}
}
