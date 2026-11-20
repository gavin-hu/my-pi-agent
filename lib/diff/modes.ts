/**
 * The three comparison scopes a git diff is taken in, and the argv for one.
 *
 * A page states a scope as one of these; the provider that runs git turns it into
 * revision arguments, and the parser never sees it. Value-only: one type, one
 * readonly table, two pure functions.
 *
 * A registration graph that needs only this imports the module, not the barrel: the
 * barrel also reaches `render.ts`, which loads the syntax tokenizer.
 */

/** The three comparison scopes the diff view offers. */
export type DiffMode = "head" | "staged" | "worktree";

/** Every valid mode, in segmented-control order. */
export const DIFF_MODES: readonly DiffMode[] = ["head", "staged", "worktree"];

/** Whether an untrusted query value names a mode. */
export function isDiffMode(value: string | null | undefined): value is DiffMode {
	return value === "head" || value === "staged" || value === "worktree";
}

/**
 * Revision arguments for `git diff` for a mode, placed before `--`.
 * `head` compares the working tree and index against the commit; `staged`
 * compares the index against the commit; `worktree` compares the working tree
 * against the index.
 */
export function diffArgs(mode: DiffMode): string[] {
	if (mode === "staged") return ["--cached"];
	if (mode === "worktree") return [];
	return ["HEAD"];
}
