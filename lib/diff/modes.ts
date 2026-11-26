/**
 * The comparison vocabulary: what one side of a diff reads, and the argv for one.
 *
 * A page states a comparison as a mode — `head`, `staged`, `worktree` — and a page that
 * compares two named ends states it as a pair of sides instead. Both resolve here, so
 * "the index is `--cached`, the tree is no revision" is said once: the review page names
 * pairs built from these sides rather than restating the argv. A mode names a comparison;
 * a side says what one end of it reads.
 *
 * A registration graph that needs only this imports the module, not the barrel: the
 * barrel also reaches `render.ts`, which loads the syntax tokenizer.
 */

/** One side of a comparison: a revision, the index, or the working tree. */
export type DiffSide = { kind: "rev"; ref: string } | { kind: "index" } | { kind: "tree" };

/**
 * Revision arguments for `git diff`, placed before `--`, for a comparison ending at `to`.
 *
 * `left` is the revision the other end names, or `undefined` when `to` is its own base:
 * the index against its own commit, or the tree against the index. A side reads as the
 * index is `--cached`, the working tree is no revision at all, and a revision is itself.
 */
export function sideArgs(left: string | undefined, to: DiffSide): string[] {
	if (to.kind === "index") return left === undefined ? ["--cached"] : ["--cached", left];
	if (to.kind === "tree") return left === undefined ? [] : [left];
	return left === undefined ? [to.ref] : [left, to.ref];
}

/** The three comparison modes the diff view offers. */
export type DiffMode = "head" | "staged" | "worktree";

/**
 * Revision arguments for `git diff` for a mode, placed before `--`.
 * `head` compares the working tree and index against the commit; `staged`
 * compares the index against the commit; `worktree` compares the working tree
 * against the index.
 */
export function diffArgs(mode: DiffMode): string[] {
	if (mode === "staged") return sideArgs(undefined, { kind: "index" });
	if (mode === "worktree") return sideArgs(undefined, { kind: "tree" });
	return sideArgs("HEAD", { kind: "tree" });
}
