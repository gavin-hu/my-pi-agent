/**
 * The plan shot's argument contract: which page the capture opens, and what it may ask for.
 *
 * One script renders one plan three ways — the owner's review page, a reviewer's shared link,
 * or the read-only view `/plan list`'s Enter opens — so the flags are the whole difference
 * between them: a view has no composer to seed, no dialog to open, and no link to post
 * through, and the parser refuses each rather than rendering a page that lacks the control.
 *
 * Split from `screenshots.test.ts`, which covers every shot's CLI at once: the plan shot's
 * own rules are one page's, and they outgrew the shared table.
 */

import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import { stripFeedback } from "../extensions/plan/feedback.ts";
import { planDigest } from "../extensions/plan/plan-text.ts";
import { parseArgs as parsePlanReviewArgs } from "./shots/plan-review.ts";
import { draftSeed } from "./shots/plan-review-capture.ts";

describe("plan shot arguments", () => {
	test("a plan path defaults the output to its stem", () => {
		const options = parsePlanReviewArgs(["docs/some-plan.md"]);
		expect(basename(options.plan)).toBe("some-plan.md");
		expect(basename(options.out)).toBe("some-plan.png");
		expect(options.width).toBe(1280);
		expect(options.scale).toBe(2);
		expect(options.theme).toBeUndefined();
		expect(options.waitMs).toBe(8000);
	});

	test("flags override the defaults", () => {
		const options = parsePlanReviewArgs([
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
		expect(basename(options.out)).toBe("shot.png");
		expect(options.width).toBe(900);
		expect(options.scale).toBe(1);
		expect(options.theme).toBe("dark");
		expect(options.waitMs).toBe(100);
	});

	test("--as captures the reviewer's page, or the read-only view", () => {
		expect(parsePlanReviewArgs(["plan.md"]).role).toBe("owner");
		expect(parsePlanReviewArgs(["plan.md", "--as", "reviewer"]).role).toBe("reviewer");
		// The page `/plan list`'s Enter opens: it renders the plan with nothing that writes.
		expect(parsePlanReviewArgs(["plan.md", "--as", "viewer"]).role).toBe("viewer");
	});

	test("--post binds a reviewer link before the capture", () => {
		// The frame shows the state after a teammate's first post, which is what binds
		// her name to the link.
		expect(parsePlanReviewArgs(["plan.md", "--as", "reviewer", "--post", "alice"]).post).toBe("alice");
		expect(parsePlanReviewArgs(["plan.md"]).post).toBeUndefined();
	});

	test("--share captures the owner's dialog, where a name may also be bound", () => {
		// The dialog is the owner's own surface, and binding one of its links needs a
		// post through that link rather than through the page being captured.
		expect(parsePlanReviewArgs(["plan.md"]).share).toBeUndefined();
		expect(parsePlanReviewArgs(["plan.md", "--share"]).share).toBe(true);
		expect(parsePlanReviewArgs(["plan.md", "--share", "--post", "alice"]).post).toBe("alice");
	});

	test("--draft starts the tab with an unsaved comment", () => {
		expect(parsePlanReviewArgs(["plan.md", "--draft", "tighten this"]).draft).toBe("tighten this");
		expect(parsePlanReviewArgs(["plan.md"]).draft).toBeUndefined();
	});

	test("a draft seed writes the record the client itself would have", () => {
		// A seed is only faithful if the client would have written the same thing: the
		// same storage key, the plan's own revision, and the first block as the anchor.
		const content = "# Plan\n\nBody\n";
		const written: Record<string, string> = {};
		const fakeWindow = { sessionStorage: { setItem: (key: string, value: string) => void (written[key] = value) } };
		new Function("window", draftSeed(content, "tighten this step"))(fakeWindow);

		expect(JSON.parse(written["bf-review-draft"] ?? "null")).toEqual({
			rev: planDigest(stripFeedback(content)),
			mine: [{ anchor: 0, comment: "tighten this step" }],
		});
	});

	test("rejects a missing plan, an unknown flag, and bad values", () => {
		const invalid: ReadonlyArray<readonly [argv: string[], message: string]> = [
			[[], "a plan path is required"],
			[["plan.md", "--nope"], "unknown option"],
			[["plan.md", "--theme", "sepia"], "--theme must be light or dark"],
			[["plan.md", "--width", "10"], "--width must be at least 320"],
			[["plan.md", "--scale", "0"], "--scale must be positive"],
			[["plan.md", "--wait", "-1"], "--wait must not be negative"],
			[["plan.md", "--width"], "--width needs a value"],
			[["plan.md", "--as", "admin"], "--as must be owner, reviewer, or viewer"],
			[["plan.md", "--as", "viewer", "--share"], "--share captures the owner's Share dialog"],
			[["plan.md", "--as", "viewer", "--post", "alice"], "--post needs --as reviewer or --share"],
			[["plan.md", "--as", "viewer", "--draft", "x"], "--draft needs a page that can write"],
			[["plan.md", "--post", "alice"], "--post needs --as reviewer or --share"],
			[["plan.md", "--as", "reviewer", "--share"], "--share captures the owner's Share dialog"],
			[["plan.md", "--as", "reviewer", "--post", "  "], "--post needs a reviewer name"],
			[["plan.md", "--draft", "  "], "--draft needs the comment text"],
			[["plan.md", "--as", "reviewer", "--post", "alice", "--draft", "x"], "--draft cannot be combined with --post"],
		];
		for (const [argv, message] of invalid) {
			expect(() => parsePlanReviewArgs(argv), argv.join(" ")).toThrow(message);
		}
	});
});
