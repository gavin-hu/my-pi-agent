/**
 * Pure rendering and parsing for the plan review's dialog presentation: the digest
 * a remote turn posts before the question, and the four options it asks.
 *
 * The options and their parser read one table, so a number, a label, and the
 * outcome cannot drift apart. File delivery and the review lifecycle stay in
 * `review.ts`.
 */

import type { InteractionLanguage } from "../../lib/interaction.ts";
import { extractPlanSteps } from "./steps.ts";

/** The four outcomes a review offers, in the order the options are numbered. */
export type PlanReviewOption = "approve" | "keep" | "cancel" | "revise";

/** One option: what the human reads, in both languages, and what it decides. */
interface ReviewOption {
	outcome: PlanReviewOption;
	zh: string;
	en: string;
}

const REVIEW_OPTIONS: readonly ReviewOption[] = [
	{ outcome: "approve", zh: "批准", en: "Approve" },
	{ outcome: "keep", zh: "继续规划", en: "Keep planning" },
	{ outcome: "cancel", zh: "退出", en: "Exit plan mode" },
	{ outcome: "revise", zh: "修改意见", en: "Revise" },
];

/** How much of one step the digest shows. */
const DIGEST_STEP_CHARS = 90;

/** The labels a review asks with, in the chat's language and in offer order. */
export function planReviewOptions(language: InteractionLanguage): string[] {
	return REVIEW_OPTIONS.map((option) => option[language]);
}

/** The question above the options; the options themselves say what each one does. */
export function planReviewQuestion(language: InteractionLanguage): string {
	return language === "zh" ? "审阅计划：" : "Review the plan:";
}

/** The editor that follows a "revise" answer. */
export function refinePrompt(language: InteractionLanguage): string {
	return language === "zh"
		? "计划要改什么？把修改意见作为一条消息发回；回复「取消」保持计划。"
		: "What should the plan change? Send the feedback as one message; reply cancel to keep planning.";
}

/**
 * One compact digest: title, first steps, mode status, and whether the file went
 * out. The plan file is sent before it, so a reader who never opens the
 * attachment still knows what is being asked.
 */
export function planReviewDigest(content: string, language: InteractionLanguage, attached: boolean): string {
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
	return [head, ...preview, more, status, attachment].filter((line) => line !== "").join("\n");
}

/**
 * Read one option back: the label in either language, or the outcome's own name,
 * which is what a client that never saw the labels answers with. Anything else —
 * a dismissal, a number the channel did not resolve, a stray word — is
 * `undefined`, and the caller keeps planning rather than guessing.
 */
export function parsePlanReviewOption(answer: string): PlanReviewOption | undefined {
	const text = answer.trim();
	if (text === "") return undefined;
	const key = text.toLowerCase();
	const match = REVIEW_OPTIONS.find(
		(option) => option.outcome === key || option.en.toLowerCase() === key || option.zh === text,
	);
	return match?.outcome;
}
