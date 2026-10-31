import { describe, expect, test } from "bun:test";
import { parsePlanReviewReply, planReviewPrompt } from "./review-prompt.ts";

const PLAN = ["# Test plan", "", "1. One", "2. Two", "3. Three", "4. Four"].join("\n");

describe("planReviewPrompt", () => {
	test("renders the English action line from the shared table", () => {
		const prompt = planReviewPrompt(PLAN, "en", true);
		expect(prompt).toContain("Plan: Test plan (4 steps)");
		expect(prompt).toContain("1. One");
		expect(prompt).toContain("2. Two");
		expect(prompt).toContain("3. Three");
		expect(prompt).toContain("… (1 more)");
		expect(prompt).toContain("Plan mode is on — write access is off.");
		expect(prompt).toContain("The plan is above.");
		expect(prompt).toContain(
			"Reply 1 approve, 2 keep planning, 3 exit — or type feedback to revise. To ask something else, exit or approve first.",
		);
	});

	test("renders the Chinese action line from the same table", () => {
		const prompt = planReviewPrompt(PLAN, "zh", true);
		expect(prompt).toContain("计划：Test plan（4 步）");
		expect(prompt).toContain("… 还有 1 步");
		expect(prompt).toContain("Plan 模式开启，写入已关闭。");
		expect(prompt).toContain("计划已在上方。");
		expect(prompt).toContain("回复 1 批准，2 继续规划，3 退出；或直接输入修改意见（想做别的先退出或批准）。");
	});

	test("drops the attachment line when no file was sent", () => {
		const prompt = planReviewPrompt(PLAN, "en", false);
		expect(prompt).not.toContain("The plan is above.");
		expect(prompt).toContain("Reply 1 approve, 2 keep planning, 3 exit");
	});
});

describe("parsePlanReviewReply", () => {
	const actions = [
		["1", { action: "approve" }],
		["approve", { action: "approve" }],
		["批准", { action: "approve" }],
		["同意", { action: "approve" }],
		["2", { action: "keep" }],
		["keep", { action: "keep" }],
		["keep planning", { action: "keep" }],
		["继续", { action: "keep" }],
		["3", { action: "cancel" }],
		["exit", { action: "cancel" }],
		["cancel", { action: "cancel" }],
		["退出", { action: "cancel" }],
	] as const;

	for (const [input, expected] of actions) {
		test(`maps ${JSON.stringify(input)} to ${expected.action}`, () => {
			expect(parsePlanReviewReply(`  ${input}  `)).toEqual(expected);
		});
	}

	test("treats any other non-empty text as a refinement", () => {
		expect(parsePlanReviewReply("1. make step 2 smaller")).toEqual({
			action: "refine",
			refinement: "1. make step 2 smaller",
		});
		expect(parsePlanReviewReply("make it shorter")).toEqual({
			action: "refine",
			refinement: "make it shorter",
		});
	});

	test("keeps planning when the reply is empty, so silence cannot leave plan mode", () => {
		// Esc, an empty Enter, and the ten-minute expiry all arrive here as nothing. Each one
		// used to end plan mode with write access restored and no approval, which is the one
		// outcome a silent prompt must never produce.
		expect(parsePlanReviewReply("")).toEqual({ action: "keep" });
		expect(parsePlanReviewReply("   ")).toEqual({ action: "keep" });
		// Leaving still takes an answer.
		expect(parsePlanReviewReply("3")).toEqual({ action: "cancel" });
		expect(parsePlanReviewReply("exit")).toEqual({ action: "cancel" });
	});
});
