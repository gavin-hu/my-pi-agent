/**
 * What a review compares, and the git arguments one comparison is taken with.
 *
 * A review reads a branch, which `file-browse`'s modes do not: its scopes are the
 * base line the branch left, the last commit, everything uncommitted against
 * HEAD, the index, and the working tree. Pure: the reader runs git, this only
 * says what to ask it.
 */

/** The five comparisons a review page offers. */
export type ReviewScope = "base" | "last" | "head" | "staged" | "worktree";

/** Longest base ref accepted; a ref longer than this is a mistake, not a branch. */
export const MAX_BASE_LENGTH = 200;

/** Every scope, in the segmented control's order. */
export const REVIEW_SCOPES: readonly ReviewScope[] = ["base", "last", "head", "staged", "worktree"];

/** Whether an untrusted word names a scope. */
export function isReviewScope(value: unknown): value is ReviewScope {
	return value === "base" || value === "last" || value === "head" || value === "staged" || value === "worktree";
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
}

/**
 * The git arguments for a scope.
 *
 * `base` and `last` read a committed range, so a file changed and then reverted
 * is absent — that is what a branch review asks. `head`, `staged` and `worktree`
 * read the tree against a ref, the index, and the tree alone: `head` is the three
 * `file-browse` modes' union, and the two beneath it are what `file-browse` calls
 * its staged and worktree modes, so the working tree is reviewable before a
 * commit exists.
 */
export function scopeArgs(scope: ReviewScope, base: string): ScopeArgs {
	if (scope === "last") {
		return { args: ["HEAD~1...HEAD"], label: "HEAD~1...HEAD", untracked: false, needsParent: true };
	}
	// Only HEAD has to exist, which the reader checks for every scope, so nothing
	// here needs a parent commit.
	if (scope === "head") return { args: ["HEAD"], label: "HEAD", untracked: true, needsParent: false };
	if (scope === "staged") return { args: ["--cached"], label: "staged", untracked: false, needsParent: false };
	if (scope === "worktree") return { args: [], label: "worktree", untracked: true, needsParent: false };
	return { args: [`${base}...HEAD`], label: `${base}...HEAD`, untracked: false, needsParent: false };
}
