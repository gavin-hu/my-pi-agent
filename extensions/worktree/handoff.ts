/**
 * The handoff an exit leaves behind: what the branch holds, and the command that
 * finishes the task.
 *
 * `AGENTS.md` ends a worktree task with a merge into the main checkout, or a pull
 * request. The exit already decides the branch's fate and keeps one that holds
 * commits; this says how many, whether the default branch already contains them,
 * and the exact commands — so the next step is read, not remembered.
 *
 * Pure: the caller has the facts, this shapes them. The tool never commits, merges,
 * pushes, or opens a pull request, because each of those acts on a checkout the
 * session is no longer isolated in.
 */

/** What a leaving worktree hands back to the main checkout. */
export interface Handoff {
	/** The worktree branch, when the session had one. */
	branch: string | null;
	/** The branch a merge would target, when it could be resolved. */
	base: string | null;
	/**
	 * Commits on the branch that the base does not contain. Undefined when git could not
	 * count them, which is not the same answer as zero: nothing is claimed from it.
	 */
	ahead: number | undefined;
	/**
	 * Commits the branch has made since the commit it was created at, when that was
	 * recorded. Absent for a worktree this package did not create.
	 */
	commits?: number;
	/** Whether the work landed: every commit is in the base, and there were commits. */
	merged: boolean;
}

/** Pluralized commit count, e.g. `1 commit` / `3 commits`, for a count that was read. */
function commits(count: number | undefined): string {
	if (count === undefined) return "commits that could not be counted";
	return `${count} commit${count === 1 ? "" : "s"}`;
}

/**
 * The `Handoff:` block: one headline and, only when there is something to do, the
 * two commands. A merged or empty branch prints no command — inviting a merge of
 * work that is already in the base is how a branch gets merged twice.
 */
export function handoffLines(handoff: Handoff): string[] {
	if (!handoff.branch) return ["Handoff: the worktree had no branch to hand off."];

	if (handoff.base === null) {
		return [
			`Handoff: branch ${handoff.branch} holds ${commits(handoff.ahead)}; its base branch could not be resolved.`,
		];
	}
	if (handoff.ahead === undefined) {
		// A count git refused is not a branch with nothing on it: printing an empty handoff
		// would invite the merge this cannot promise is safe.
		return [`Handoff: ${handoff.branch} could not be counted against ${handoff.base} — check it before merging.`];
	}
	if (handoff.merged || handoff.ahead === 0) {
		// "Merged" is a claim that work landed; a branch with no commits of its own never had
		// any to land, and saying so is what stops an empty worktree reading as finished.
		const landed = handoff.merged && handoff.commits !== 0;
		const state = landed ? `is merged into ${handoff.base}` : `has no commits beyond ${handoff.base}`;
		return [`Handoff: ${handoff.branch} ${state} — nothing to merge.`];
	}

	return [
		`Handoff: ${handoff.branch} is ${commits(handoff.ahead)} ahead of ${handoff.base}.`,
		`  merge:  git switch ${handoff.base} && git merge --no-ff ${handoff.branch}`,
		`  or PR:  gh pr create --head ${handoff.branch} --fill`,
	];
}
