/**
 * Pure rendering and parsing for the compact remote plan review.
 *
 * The prompt and its reply share one action table, so changing a number or a
 * localized label cannot leave the parser behind. File delivery and the review
 * lifecycle stay in `review.ts`.
 */

import type { InteractionLanguage } from "../../lib/interaction.ts";
import { extractPlanSteps } from "./steps.ts";

/** The actions the compact prompt can resolve without a refinement. */
export type PlanReviewAction = "approve" | "keep" | "cancel";

/** One editor reply: an action, or free text the model should apply. */
export type PlanReviewReply =
	| { action: "approve" }
	| { action: "keep" }
	| { action: "cancel" }
	| { action: "refine"; refinement: string };

interface ReviewAction {
	key: string;
	action: PlanReviewAction;
	zh: string;
	en: string;
	words: readonly string[];
}

/** The action line and the parser read this one table, in display order. */
const REVIEW_ACTIONS: readonly ReviewAction[] = [
	{ key: "1", action: "approve", zh: "批准", en: "approve", words: ["approve", "批准", "同意"] },
	{
		key: "2",
		action: "keep",
		zh: "继续规划",
		en: "keep planning",
		words: ["keep", "keep planning", "继续", "继续规划"],
	},
	{ key: "3", action: "cancel", zh: "退出", en: "exit", words: ["exit", "cancel", "quit", "退出", "取消"] },
];

/** How much of one step the remote digest shows. */
const DIGEST_STEP_CHARS = 90;

/**
 * One compact remote prompt: title, first steps, mode status, and the action
 * line. The plan file is sent before it; a non-action reply refines the plan.
 */
export function planReviewPrompt(content: string, language: InteractionLanguage, attached: boolean): string {
	const title = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
	const steps = extractPlanSteps(content);
	const count = steps.length;
	const head =
		language === "zh"
			? `计划${title ? `：${title}` : ""}${count > 0 ? `（${count} 步）` : ""}`
			: `Plan${title ? `: ${title}` : ""}${count > 0 ? ` (${count} step${count === 1 ? "" : "s"})` : ""}`;
	const preview = steps.slice(0, 3).map((step, index) => {
		const text = step.content.replace(/\s+/g, " ").trim();
		const shown = text.length > DIGEST_STEP_CHARS ? `${text.slice(0, DIGEST_STEP_CHARS - 1)}…` : text;
		return `${index + 1}. ${shown}`;
	});
	const more =
		count > preview.length
			? language === "zh"
				? `… 还有 ${count - preview.length} 步`
				: `… (${count - preview.length} more)`
			: "";
	const status = language === "zh" ? "Plan 模式开启，写入已关闭。" : "Plan mode is on — write access is off.";
	const attachment = attached ? (language === "zh" ? "计划已在上方。" : "The plan is above.") : "";
	const choices = REVIEW_ACTIONS.map((action) => `${action.key} ${action[language]}`).join(
		language === "zh" ? "，" : ", ",
	);
	const actions =
		language === "zh"
			? `回复 ${choices}；或直接输入修改意见（想做别的先退出或批准）。`
			: `Reply ${choices} — or type feedback to revise. To ask something else, exit or approve first.`;
	return [head, ...preview, more, status, attachment, actions].filter((line) => line !== "").join("\n");
}

/**
 * Parse the one editor reply. Only an exact number or action word is an action;
 * any other non-empty text is a refinement request.
 *
 * An empty reply — Esc, an empty Enter, or the prompt expiring unanswered — is
 * `keep`, not `cancel`: a silent prompt is not a decision, and nothing here may
 * end plan mode and hand write access back without one. Leaving takes an answer.
 */
export function parsePlanReviewReply(raw: string): PlanReviewReply {
	const text = raw.trim();
	if (text === "") return { action: "keep" };
	const key = text.toLowerCase();
	for (const action of REVIEW_ACTIONS) {
		if (key === action.key || action.words.includes(key)) return { action: action.action };
	}
	return { action: "refine", refinement: text };
}
