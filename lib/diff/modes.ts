/**
 * The three comparison scopes, and the argv for one.
 *
 * A page states a scope as one of these; the provider that runs git turns it into
 * revision arguments, and the parser never sees it. What names one is each page's own
 * `ReviewScope`/`DiffMode` table now — nothing parses an untrusted mode here any more,
 * since the last route that took one is gone. Value-only: one type, one pure function.
 *
 * A registration graph that needs only this imports the module, not the barrel: the
 * barrel also reaches `render.ts`, which loads the syntax tokenizer.
 */

/** The three comparison scopes the diff view offers. */
export type DiffMode = "head" | "staged" | "worktree";

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
