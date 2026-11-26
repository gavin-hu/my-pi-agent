/**
 * What a review compares, and the git arguments one comparison is taken with.
 *
 * A scope is a pair of sides — `from → to` — and each side is a revision, the index, or
 * the working tree. Six presets name the pairs a reader asks for by habit; the pair is
 * what the snapshot, the fingerprint and a scope change read, so a name can never drift
 * from what it drew.
 *
 * Three rules are derived, not declared per preset: a commit-to-commit scope reads
 * `merge-base(from, to)` against `to`; untracked files join exactly when `to` is the
 * working tree; and a scope whose ends read the same thing is refused rather than drawn
 * empty. Pure: the reader runs git, this says what to ask it and what to call the answer.
 */

import type { DiffSide } from "../../lib/diff/modes.ts";

/** One comparison: the two sides of a single diff. */
export interface ReviewScope {
	from: DiffSide;
	to: DiffSide;
}

/** Longest base ref accepted; a ref longer than this is a mistake, not a branch. */
export const MAX_BASE_LENGTH = 200;

/** The comparisons a reader asks for by name, in the segmented control's order. */
export const REVIEW_PRESETS = ["change", "branch", "last", "uncommitted", "staged", "worktree"] as const;

/** One of those names. */
export type ReviewPreset = (typeof REVIEW_PRESETS)[number];

/**
 * A preset's left end before the default branch is known: `default` is the ref the
 * configured base or the repository's own branch resolves to, so `change` and `branch`
 * follow whatever a project lands on.
 */
type PresetFrom = DiffSide | "default";

/** The sides one preset compares. */
const PRESETS: Record<ReviewPreset, { from: PresetFrom; to: DiffSide }> = {
	// The default is the whole change: what would land if every uncommitted thing were committed.
	change: { from: "default", to: { kind: "tree" } },
	branch: { from: "default", to: { kind: "rev", ref: "HEAD" } },
	last: { from: { kind: "rev", ref: "HEAD^" }, to: { kind: "rev", ref: "HEAD" } },
	uncommitted: { from: { kind: "rev", ref: "HEAD" }, to: { kind: "tree" } },
	staged: { from: { kind: "rev", ref: "HEAD" }, to: { kind: "index" } },
	worktree: { from: { kind: "index" }, to: { kind: "tree" } },
};

/** What each preset's tab says it compares. */
const PRESET_TITLES: Record<ReviewPreset, string> = {
	change: "the whole change — the branch and everything uncommitted",
	branch: "the branch against its base",
	last: "HEAD^...HEAD — the last commit, its first parent on a merge",
	uncommitted: "HEAD → working tree — everything not committed",
	staged: "HEAD → index — what the next commit carries",
	worktree: "index → working tree — what is not staged",
};

/** Whether an untrusted word names a preset. */
export function isReviewPreset(value: unknown): value is ReviewPreset {
	return typeof value === "string" && (REVIEW_PRESETS as readonly string[]).includes(value);
}

/** The preset a word names, or `undefined` when it names none. */
export function parsePreset(value: string | null | undefined): ReviewPreset | undefined {
	return isReviewPreset(value) ? value : undefined;
}

/** What a preset's tab says it compares. */
export function presetTitle(preset: ReviewPreset): string {
	return PRESET_TITLES[preset];
}

/**
 * The scope a preset names. A preset whose left end is the default resolves to
 * `defaultRef`; with none resolved it answers `undefined`, since there is no scope to
 * draw and the reader owes the sentence saying why.
 */
export function presetScope(preset: ReviewPreset, defaultRef: string | undefined): ReviewScope | undefined {
	const { from, to } = PRESETS[preset];
	if (from !== "default") return { from, to };
	return defaultRef === undefined ? undefined : { from: { kind: "rev", ref: defaultRef }, to };
}

/** The preset a scope names, or `undefined` when a reader typed the pair itself. */
export function presetOf(scope: ReviewScope, defaultRef: string | undefined): ReviewPreset | undefined {
	return REVIEW_PRESETS.find((preset) => {
		const named = presetScope(preset, defaultRef);
		return named !== undefined && sameSide(named.from, scope.from) && sameSide(named.to, scope.to);
	});
}

/** Whether two scopes compare the same two sides. */
export function sameScope(a: ReviewScope, b: ReviewScope): boolean {
	return wireSide(a.from) === wireSide(b.from) && wireSide(a.to) === wireSide(b.to);
}

/** Whether two sides read the same thing. */
function sameSide(a: DiffSide, b: DiffSide): boolean {
	return wireSide(a) === wireSide(b);
}

/** The sentence a scope whose ends read the same thing owes. */
export const NO_COMPARISON = "this comparison reads the same side at both ends — pick a different scope";

/** The side a word names — a revision, `index`, or `tree` — or `undefined` for nothing. */
export function parseSide(word: string | null | undefined): DiffSide | undefined {
	const trimmed = word?.trim() ?? "";
	if (trimmed === "") return undefined;
	if (trimmed === "index") return { kind: "index" };
	if (trimmed === "tree") return { kind: "tree" };
	return { kind: "rev", ref: trimmed };
}

/** The word a side is typed as, so a link and a tool call say the same thing. */
export function wireSide(side: DiffSide): string {
	return side.kind === "rev" ? side.ref : side.kind;
}

/** Whether a scope compares anything at all. */
export function comparesNothing(scope: ReviewScope): boolean {
	if (scope.from.kind === "tree") return true;
	if (scope.from.kind === "index") return scope.to.kind !== "tree";
	return scope.to.kind === "rev" && scope.from.ref === scope.to.ref;
}

/** What the page calls a scope: the range it reads, or the two sides with an arrow. */
export function scopeLabel(scope: ReviewScope): string {
	if (scope.from.kind === "rev" && scope.to.kind === "rev") return `${scope.from.ref}...${scope.to.ref}`;
	return `${sideLabel(scope.from)} → ${sideLabel(scope.to)}`;
}

/** One side as a person reads it. */
export function sideLabel(side: DiffSide): string {
	if (side.kind === "index") return "index";
	if (side.kind === "tree") return "working tree";
	return side.ref;
}
