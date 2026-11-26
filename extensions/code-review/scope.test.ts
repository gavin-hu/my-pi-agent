import { describe, expect, test } from "bun:test";
import {
	comparesNothing,
	MAX_BASE_LENGTH,
	NO_COMPARISON,
	parsePreset,
	presetOf,
	presetScope,
	presetTitle,
	REVIEW_PRESETS,
	scopeLabel,
	type ReviewScope,
} from "./scope.ts";

/** Every preset as the page would open it against a resolved default branch. */
const opened = (): Array<[string, ReviewScope]> =>
	REVIEW_PRESETS.map((preset) => [
		preset,
		presetScope(preset, "origin/main") ?? { from: { kind: "tree" }, to: { kind: "tree" } },
	]);

describe("the review's presets", () => {
	test("are the six the segmented control offers, breadth first", () => {
		expect(REVIEW_PRESETS).toEqual(["change", "branch", "last", "uncommitted", "staged", "worktree"]);
	});

	test("accept only their own words", () => {
		for (const preset of REVIEW_PRESETS) {
			expect(parsePreset(preset)).toBe(preset);
		}
		for (const other of ["base", "head", "HEAD", "", null, undefined, 3]) {
			expect(parsePreset(other as string | null | undefined)).toBeUndefined();
		}
	});

	test("give every preset a title, so a new one adds its row where its sides are", () => {
		for (const preset of REVIEW_PRESETS) {
			expect(presetTitle(preset)).not.toBe("");
		}
		expect(presetTitle("change")).toContain("uncommitted");
		expect(presetTitle("last")).toContain("first parent");
	});

	test("name a scope only once the default branch is known", () => {
		expect(presetScope("change", undefined)).toBeUndefined();
		expect(presetScope("branch", undefined)).toBeUndefined();
		expect(presetScope("last", undefined)).toEqual({
			from: { kind: "rev", ref: "HEAD^" },
			to: { kind: "rev", ref: "HEAD" },
		});
	});

	test("read the whole change by default, and the commits alone when asked", () => {
		expect(presetScope("change", "origin/main")).toEqual({
			from: { kind: "rev", ref: "origin/main" },
			to: { kind: "tree" },
		});
		expect(presetScope("branch", "origin/main")).toEqual({
			from: { kind: "rev", ref: "origin/main" },
			to: { kind: "rev", ref: "HEAD" },
		});
		expect(presetScope("uncommitted", "origin/main")).toEqual({
			from: { kind: "rev", ref: "HEAD" },
			to: { kind: "tree" },
		});
		expect(presetScope("staged", "origin/main")).toEqual({
			from: { kind: "rev", ref: "HEAD" },
			to: { kind: "index" },
		});
		expect(presetScope("worktree", "origin/main")).toEqual({
			from: { kind: "index" },
			to: { kind: "tree" },
		});
	});

	test("are recognised again from the scope they opened", () => {
		for (const [preset, scope] of opened()) {
			expect(presetOf(scope, "origin/main")).toBe(preset as never);
		}
	});

	test("leave a pair a reader typed unnamed", () => {
		const stagedOnly: ReviewScope = { from: { kind: "rev", ref: "origin/main" }, to: { kind: "index" } };
		expect(presetOf(stagedOnly, "origin/main")).toBeUndefined();
		const otherBranch: ReviewScope = {
			from: { kind: "rev", ref: "origin/feature" },
			to: { kind: "rev", ref: "origin/main" },
		};
		expect(presetOf(otherBranch, "origin/main")).toBeUndefined();
	});
});

describe("a scope's sides", () => {
	test("refuse a comparison that reads the same thing twice", () => {
		expect(comparesNothing({ from: { kind: "rev", ref: "HEAD" }, to: { kind: "rev", ref: "HEAD" } })).toBe(true);
		expect(comparesNothing({ from: { kind: "index" }, to: { kind: "index" } })).toBe(true);
		expect(comparesNothing({ from: { kind: "index" }, to: { kind: "rev", ref: "HEAD" } })).toBe(true);
		expect(comparesNothing({ from: { kind: "tree" }, to: { kind: "rev", ref: "HEAD" } })).toBe(true);
	});

	test("count the comparisons a page can actually draw", () => {
		expect(comparesNothing({ from: { kind: "rev", ref: "HEAD" }, to: { kind: "tree" } })).toBe(false);
		expect(comparesNothing({ from: { kind: "index" }, to: { kind: "tree" } })).toBe(false);
		expect(comparesNothing({ from: { kind: "rev", ref: "origin/main" }, to: { kind: "rev", ref: "HEAD" } })).toBe(
			false,
		);
	});

	test("say why an empty one is refused, in the sentence the page prints", () => {
		expect(NO_COMPARISON).toContain("same side");
	});

	test("print a range for two commits and an arrow when a side is not one", () => {
		expect(scopeLabel({ from: { kind: "rev", ref: "origin/main" }, to: { kind: "rev", ref: "HEAD" } })).toBe(
			"origin/main...HEAD",
		);
		expect(scopeLabel({ from: { kind: "rev", ref: "origin/main" }, to: { kind: "tree" } })).toBe(
			"origin/main → working tree",
		);
		expect(scopeLabel({ from: { kind: "index" }, to: { kind: "tree" } })).toBe("index → working tree");
		expect(scopeLabel({ from: { kind: "rev", ref: "HEAD" }, to: { kind: "index" } })).toBe("HEAD → index");
	});

	test("bound a ref by the same length the tool parameter does", () => {
		expect(MAX_BASE_LENGTH).toBe(200);
	});
});
