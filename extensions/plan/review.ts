/**
 * The plan review gate: ask the human about a plan file and return one decision.
 *
 * A review has three presentations — the scrollable TUI screen, a dialog-only
 * editor, and a remote turn's compact editor prompt — and one optional browser
 * server. This module owns the loop that switches between
 * them, so `exit_plan_mode` and `/plan review` share one lifecycle and only map
 * the returned {@link ReviewDecision} to their own result.
 *
 * It also owns the review baseline: a review marks the content the human was
 * actually shown, never content that was only about to be shown, and the abort
 * signal reaches the browser server so an aborted turn closes it.
 */

import { basename } from "node:path";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { askHuman, isRemoteTurn, remoteLanguage } from "../../lib/interaction.ts";
import { FULL_SCREEN_OVERLAY } from "../../lib/tui/chrome.ts";
import { feedbackSummary, type PlanAnnotation } from "./feedback.ts";
import type { PlanUnit } from "../../lib/plans/team.ts";
import type { PlanStore, StoredPlan } from "./plans.ts";
import type { SectionDigest } from "./plan-text.ts";
import { planReviewPrompt, parsePlanReviewReply } from "./review-prompt.ts";
import { PlanViewComponent, type PlanViewAction } from "./tui.ts";
import type { PlanReviewResult, PlanReviewSession, PlanWebReview } from "./web.ts";

/** A choice from the review screen, with the refinement the screen carried, if any. */
interface PlanReviewChoice {
	action: PlanViewAction;
	refinement?: string;
}

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
	/** The split approval would write, so the screen shows what is being approved. */
	split?: ReviewSplit;
}

/** A validated split, as the review screen displays it. */
export interface ReviewSplit {
	lead: string;
	units: readonly PlanUnit[];
	verdict: "pair" | "team";
}

/** Prompt shown by the dialog-based refine editor in non-TUI modes. */
const REFINE_PROMPT = "Refine the plan — what should change? (Enter to save, Esc to cancel)";

/**
 * How long a remote review waits for its answer. Much longer than a plain dialog's
 * bound, because the human has to read the plan first and a phone is a slow place
 * to do it; an expiry here also ends plan mode, so it must not be easy to hit.
 */
export const PLAN_REVIEW_TIMEOUT_MS = 600_000;

/**
 * Ask the user to review the plan file. The TUI opens the scrollable screen;
 * dialog-capable modes (RPC/WeChat) get one editor prompt. A reply that is not an
 * action is a refinement.
 */
async function askPlanReview(
	ctx: ExtensionToolContext,
	plan: StoredPlan,
	baseline: SectionDigest[] | undefined,
	split: ReviewSplit | undefined,
): Promise<PlanReviewChoice> {
	const language = remoteLanguage(ctx) ?? "en";
	const remote = isRemoteTurn(ctx);
	return askHuman<PlanReviewChoice>(ctx, {
		custom: async () => {
			const choice = await ctx.ui.custom<PlanReviewChoice | undefined>(
				(tui, theme, _keybindings, done) =>
					new PlanViewComponent({
						plan,
						baseline,
						...(split === undefined ? {} : { split }),
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
			const answer = await ctx.ui.editor(planReviewPrompt(plan.content, language, remote), "");
			return parsePlanReviewReply(answer ?? "");
		},
		// The full plan is the artifact under review, so it goes out before the
		// choices; if the upload fails, the same text is the fallback.
		file: { path: plan.path, name: basename(plan.relativePath) },
		body: plan.content,
		timeoutMs: PLAN_REVIEW_TIMEOUT_MS,
	});
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
	/**
	 * Called when a shared reviewer's post lands, so the owner learns about it where
	 * they are waiting: the page updates itself, the terminal has to be told.
	 */
	onReviewerComment?: (author: string, count: number) => void;
	/** A line the page shows the owner, such as why approval belongs in the terminal. */
	note?: string;
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
		.start(cwd, plan, {
			canApprove: options.canApprove,
			baseline: options.baseline,
			signal: options.signal,
			...(options.note === undefined ? {} : { note: options.note }),
			...(options.onReviewerComment === undefined ? {} : { onReviewerComment: options.onReviewerComment }),
		})
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
	const { ctx, web, plans, baselines, signal, split } = options;
	let plan = options.plan;
	for (;;) {
		// An aborted turn has nobody left to answer the screen.
		if (signal?.aborted) return { action: "keep", plan };
		// Read the baseline before the screen and mark it after, so what the next
		// review compares against is the content this one actually showed.
		const baseline = baselines.reviewed(plan.path);
		const choice = await askPlanReview(ctx, plan, baseline, split);
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

		// A split section exists only after approval, and the page anchors comments to
		// source lines, so a page cannot show — or approve — a plan it cannot carry.
		// The terminal review is where the split is approved.
		const splitNote =
			split === undefined
				? undefined
				: "This plan has a split, which the page cannot show; approve it in the terminal review.";
		if (splitNote !== undefined) ctx.ui.notify(splitNote, "info");
		const result = await runBrowserReview(web, ctx.cwd, plan, {
			canApprove: split === undefined,
			...(splitNote === undefined ? {} : { note: splitNote }),
			baseline,
			signal,
			onOpened: (session) => ctx.ui.notify(`Plan review: opened ${session.url}`, "info"),
			onReviewerComment: (author, count) =>
				ctx.ui.notify(`Plan review: @${author} posted ${count === 1 ? "a comment" : `${count} comments`}.`, "info"),
		});
		if (!result) {
			ctx.ui.notify("Plan review: could not start the browser review server.", "error");
			continue;
		}
		if (result.status === "approved") return { action: "approve", plan: result.plan, comments: result.annotations };
		if (result.status === "saved") {
			// A save with no comments asks for nothing, so it returns to the screen the
			// way an empty refine editor does, instead of reporting a refinement nobody
			// wrote.
			const refinement = feedbackSummary(result.annotations);
			if (!refinement) {
				plan = result.plan;
				continue;
			}
			return { action: "refine", plan: result.plan, refinement, comments: result.annotations, fromBrowser: true };
		}
		// Cancelled or the tab closed: the file may have been rewritten underneath,
		// so re-read it before showing the screen again.
		plan = (await plans.read(ctx.cwd, plan.path)) ?? plan;
	}
}
