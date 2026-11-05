import { describe, expect, test } from "bun:test";
import {
	parsePlanReviewOption,
	planReviewDigest,
	planReviewOptions,
	planReviewQuestion,
	refinePrompt,
} from "./review-prompt.ts";

const PLAN = ["# Test plan", "", "1. One", "2. Two", "3. Three", "4. Four"].join("\n");

describe("planReviewDigest", () => {
	test("renders the English digest from the plan's title and first steps", () => {
		const digest = planReviewDigest(PLAN, "en", true);
		expect(digest).toContain("Plan: Test plan (4 steps)");
		expect(digest).toContain("1. One");
		expect(digest).toContain("2. Two");
		expect(digest).toContain("3. Three");
		expect(digest).toContain("… (1 more)");
		expect(digest).toContain("Plan mode is on — write access is off.");
		expect(digest).toContain("The plan is above.");
		// The options carry the choices, so the digest never names them.
		expect(digest).not.toContain("Reply 1");
	});

	test("renders the Chinese digest", () => {
		const digest = planReviewDigest(PLAN, "zh", true);
		expect(digest).toContain("计划：Test plan（4 步）");
		expect(digest).toContain("… 还有 1 步");
		expect(digest).toContain("Plan 模式开启，写入已关闭。");
		expect(digest).toContain("计划已在上方。");
	});

	test("drops the attachment line when no file was sent", () => {
		const digest = planReviewDigest(PLAN, "en", false);
		expect(digest).not.toContain("The plan is above.");
		expect(digest).toContain("Plan mode is on");
	});
});

describe("the review's four options", () => {
	test("offers approve, keep planning, exit, and revise in that order", () => {
		expect(planReviewOptions("en")).toEqual(["Approve", "Keep planning", "Exit plan mode", "Revise"]);
		expect(planReviewOptions("zh")).toEqual(["批准", "继续规划", "退出", "修改意见"]);
	});

	test("asks one question above them, and one editor for a revision", () => {
		expect(planReviewQuestion("en")).toBe("Review the plan:");
		expect(planReviewQuestion("zh")).toBe("审阅计划：");
		expect(refinePrompt("en")).toContain("cancel");
		expect(refinePrompt("zh")).toContain("取消");
	});
});

describe("parsePlanReviewOption", () => {
	const answers = [
		["Approve", "approve"],
		["approve", "approve"],
		["批准", "approve"],
		["Keep planning", "keep"],
		["keep", "keep"],
		["继续规划", "keep"],
		["Exit plan mode", "cancel"],
		["cancel", "cancel"],
		["退出", "cancel"],
		["Revise", "revise"],
		["revise", "revise"],
		["修改意见", "revise"],
	] as const;

	for (const [input, expected] of answers) {
		test(`maps ${JSON.stringify(input)} to ${expected}`, () => {
			expect(parsePlanReviewOption(`  ${input}  `)).toBe(expected);
		});
	}

	test("answers undefined for anything it does not know, so the caller keeps planning", () => {
		// Silence is Esc, an empty Enter, and the ten-minute expiry: each one used to end
		// plan mode with write access restored and no approval, which is the one outcome
		// a silent prompt must never produce.
		expect(parsePlanReviewOption("")).toBeUndefined();
		expect(parsePlanReviewOption("   ")).toBeUndefined();
		// Free text is not an instruction here: the revision has its own option, so a
		// mistyped word is re-asked instead of reaching the model as feedback.
		expect(parsePlanReviewOption("make it shorter")).toBeUndefined();
	});
});
