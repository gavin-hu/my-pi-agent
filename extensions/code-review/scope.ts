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

/**
 * How a scope is named where the name is a word rather than the range it compares.
 *
 * The control offers every scope by its word, and the header names the one showing
 * by the same word, so `head` reads as `uncommitted` in both places: a bare `HEAD`
 * beside `base...HEAD` invites "compare HEAD with itself" instead of "show me
 * everything not committed". `base` and `last` are the exceptions — a reader wants
 * the range, so their header label is the range itself.
 */
export const SCOPE_WORDS: Readonly<Record<ReviewScope, string>> = {
	base: "base",
	last: "HEAD~1",
	head: "uncommitted",
	staged: "staged",
	worktree: "worktree",
};

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
	/** What the scope's segmented-control title says it compares. */
	title: string;
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
		return {
			args: ["HEAD~1...HEAD"],
			label: "HEAD~1...HEAD",
			untracked: false,
			needsParent: true,
			title: "HEAD~1...HEAD — the last commit",
		};
	}
	// Only HEAD has to exist, which the reader checks for this scope, so it needs no
	// parent commit: `git diff HEAD` compares against the commit itself.
	if (scope === "head") {
		return {
			args: ["HEAD"],
			label: SCOPE_WORDS.head,
			untracked: true,
			needsParent: false,
			title: "uncommitted — the index and the tree against HEAD",
		};
	}
	if (scope === "staged") {
		return {
			args: ["--cached"],
			label: SCOPE_WORDS.staged,
			untracked: false,
			needsParent: false,
			title: "staged — the index against HEAD",
		};
	}
	if (scope === "worktree") {
		return {
			args: [],
			label: SCOPE_WORDS.worktree,
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
