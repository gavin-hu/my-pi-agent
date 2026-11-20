/**
 * What a review compares, and the git arguments one comparison is taken with.
 *
 * A review reads a branch, which `file-browse`'s modes do not: its four scopes
 * are the base line the branch left, the last commit, the index, and the working
 * tree. Pure: the reader runs git, this only says what to ask it.
 */

/** The four comparisons a review page offers. */
export type ReviewScope = "base" | "last" | "staged" | "worktree";

/** Longest base ref accepted; a ref longer than this is a mistake, not a branch. */
export const MAX_BASE_LENGTH = 200;

/** Every scope, in the segmented control's order. */
export const REVIEW_SCOPES: readonly ReviewScope[] = ["base", "last", "staged", "worktree"];

/** Whether an untrusted word names a scope. */
export function isReviewScope(value: unknown): value is ReviewScope {
	return value === "base" || value === "last" || value === "staged" || value === "worktree";
}

/** The word a scope is typed as, or `undefined` when it is not one. */
export function parseScope(value: string | null | undefined): ReviewScope | undefined {
	return isReviewScope(value) ? value : undefined;
}

/** One scope as the reader runs it. */
export interface ScopeArgs {
	/** Revision arguments for `git diff`, placed before `--`. */
	args: string[];
	/** What the page's header names the comparison by. */
	label: string;
	/** True when untracked files join the change list. */
	untracked: boolean;
	/** True when the scope cannot answer before HEAD's first commit. */
	needsParent: boolean;
	/** What the scope's segmented-control title says it compares. */
	title: string;
}

/**
 * The git arguments for a scope.
 *
 * `base` and `last` read a committed range, so a file changed and then reverted
 * is absent — that is what a branch review asks. `staged` and `worktree` read
 * the index and the tree, exactly the two `file-browse` offers, so the working
 * tree is reviewable before a commit exists.
 */
export function scopeArgs(scope: ReviewScope, base: string): ScopeArgs {
	if (scope === "last") {
		return {
			args: ["HEAD~1...HEAD"],
			label: "HEAD~1...HEAD",
			untracked: false,
			needsParent: true,
			title: "HEAD~1...HEAD — the last commit",
		};
	}
	if (scope === "staged") {
		return {
			args: ["--cached"],
			label: "staged",
			untracked: false,
			needsParent: false,
			title: "staged — the index against HEAD",
		};
	}
	if (scope === "worktree") {
		return {
			args: [],
			label: "worktree",
			untracked: true,
			needsParent: false,
			title: "worktree — the working tree against the index",
		};
	}
	return {
		args: [`${base}...HEAD`],
		label: `${base}...HEAD`,
		untracked: false,
		needsParent: false,
		title: "the branch against its base",
	};
}
