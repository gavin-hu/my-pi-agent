import { describe, expect, test } from "bun:test";
import { buildReviewPageData, parseArgs } from "./plan-review-shot.ts";

describe("parseArgs", () => {
	test("a plan path defaults the output to its stem", () => {
		const options = parseArgs(["docs/some-plan.md"]);
		expect(options.plan.endsWith("/docs/some-plan.md")).toBe(true);
		expect(options.out.endsWith("/some-plan.png")).toBe(true);
		expect(options.width).toBe(1280);
		expect(options.scale).toBe(2);
		expect(options.theme).toBeUndefined();
	});

	test("flags override the defaults", () => {
		const options = parseArgs([
			"plan.md",
			"-o",
			"shot.png",
			"--width",
			"900",
			"--scale",
			"1",
			"--theme",
			"dark",
			"--wait",
			"100",
		]);
		expect(options.out.endsWith("/shot.png")).toBe(true);
		expect(options.width).toBe(900);
		expect(options.scale).toBe(1);
		expect(options.theme).toBe("dark");
		expect(options.waitMs).toBe(100);
	});

	test("rejects a missing plan, an unknown flag, and bad values", () => {
		expect(() => parseArgs([])).toThrow("a plan path is required");
		expect(() => parseArgs(["plan.md", "--nope"])).toThrow("unknown option");
		expect(() => parseArgs(["plan.md", "--theme", "sepia"])).toThrow("--theme must be light or dark");
		expect(() => parseArgs(["plan.md", "--width", "10"])).toThrow("--width must be at least 320");
		expect(() => parseArgs(["plan.md", "--scale", "0"])).toThrow("--scale must be positive");
	});
});

describe("buildReviewPageData", () => {
	const plan = [
		"# Add rate limiting",
		"",
		"## Goal",
		"",
		"Keep the API usable.",
		"",
		"```ts",
		"const x = 1;",
		"```",
		"",
		"## Approach",
		"",
		"- [ ] Add a bucket",
		"> [!REVIEW] what about the burst case?",
		"",
	].join("\n");

	test("anchors blocks, outline, title, and feedback", () => {
		const data = buildReviewPageData(plan, "/plans/2026-10-16-1622-add-rate-limiting.md", "t");
		expect(data.title).toBe("Add rate limiting");
		expect(data.token).toBe("t");
		expect(data.outline.map((item) => item.text)).toEqual(["Add rate limiting", "Goal", "Approach"]);
		expect(data.outline[0]?.level).toBe(1);
		expect(data.outline[1]?.id).toBe("s-2");
		// The feedback line is stripped from the blocks but kept as an annotation.
		expect(data.annotations).toEqual([{ anchor: 12, comment: "what about the burst case?" }]);
		expect(data.blocks.some((block) => block.kind === "code")).toBe(true);
	});

	test("falls back to the file-name slug when there is no H1", () => {
		const data = buildReviewPageData("## Only a section\nbody\n", "/plans/2026-10-16-1622-my-plan.md", "t");
		expect(data.title).toBe("my-plan");
	});

	test("highlights a typed code fence by its start line", () => {
		const data = buildReviewPageData(plan, "p.md", "t");
		const codeBlock = data.blocks.find((block) => block.kind === "code");
		expect(codeBlock).toBeDefined();
		expect(data.code[String(codeBlock?.start)]?.length).toBeGreaterThan(0);
	});
});
