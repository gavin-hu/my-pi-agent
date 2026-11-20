import { describe, expect, test } from "bun:test";
import { isReviewScope, parseScope, REVIEW_SCOPES, scopeArgs } from "./scope.ts";

describe("the review's scopes", () => {
	test("are the five the page's segmented control offers, in that order", () => {
		expect(REVIEW_SCOPES).toEqual(["base", "last", "head", "staged", "worktree"]);
	});

	test("accept only their own words", () => {
		for (const scope of REVIEW_SCOPES) {
			expect(isReviewScope(scope)).toBe(true);
			expect(parseScope(scope)).toBe(scope);
		}
		for (const other of ["HEAD", "", "Base", null, undefined, 3]) {
			expect(isReviewScope(other)).toBe(false);
			expect(parseScope(other as string | null | undefined)).toBeUndefined();
		}
	});

	test("read a branch against its base, and name the range they compare", () => {
		expect(scopeArgs("base", "origin/main")).toEqual({
			args: ["origin/main...HEAD"],
			label: "origin/main...HEAD",
			untracked: false,
			needsParent: false,
		});
	});

	test("read the last commit, refusing before HEAD has a parent", () => {
		expect(scopeArgs("last", "main")).toEqual({
			args: ["HEAD~1...HEAD"],
			label: "HEAD~1...HEAD",
			untracked: false,
			needsParent: true,
		});
	});

	test("read the index and the working tree, and only the tree has untracked files", () => {
		expect(scopeArgs("staged", "main").args).toEqual(["--cached"]);
		expect(scopeArgs("staged", "main").untracked).toBe(false);
		expect(scopeArgs("worktree", "main").args).toEqual([]);
		expect(scopeArgs("worktree", "main").untracked).toBe(true);
	});

	test("read everything uncommitted against HEAD, untracked files joining it", () => {
		expect(scopeArgs("head", "main")).toEqual({
			args: ["HEAD"],
			label: "uncommitted",
			untracked: true,
			needsParent: false,
		});
	});
});
