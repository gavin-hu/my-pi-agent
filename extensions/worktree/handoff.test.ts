import { describe, expect, test } from "bun:test";
import { handoffLines, type Handoff } from "./handoff.ts";

/** A handoff with the given facts over a branch with one unmerged commit. */
function handoff(over: Partial<Handoff> = {}): Handoff {
	return { branch: "worktree-x", base: "main", ahead: 1, merged: false, ...over };
}

describe("handoffLines", () => {
	test("names the branch, its lead, and both ways to finish", () => {
		expect(handoffLines(handoff())).toEqual([
			"Handoff: worktree-x is 1 commit ahead of main.",
			"  merge:  git switch main && git merge --no-ff worktree-x",
			"  or PR:  gh pr create --head worktree-x --fill",
		]);
	});

	test("pluralizes the commit count", () => {
		expect(handoffLines(handoff({ ahead: 3 }))[0]).toBe("Handoff: worktree-x is 3 commits ahead of main.");
	});

	test("prints no command for a branch the base already contains", () => {
		expect(handoffLines(handoff({ merged: true, ahead: 0 }))).toEqual([
			"Handoff: worktree-x is merged into main — nothing to merge.",
		]);
		// A merged branch can still report a non-zero lead when the base moved on;
		// the merged fact wins, so no merge is invited.
		expect(handoffLines(handoff({ merged: true, ahead: 2 }))).toHaveLength(1);
	});

	test("prints no command for a branch with no commits", () => {
		expect(handoffLines(handoff({ ahead: 0 }))).toEqual([
			"Handoff: worktree-x has no commits beyond main — nothing to merge.",
		]);
	});

	test("does not invent a merge target when the base is unknown", () => {
		const lines = handoffLines(handoff({ base: null, ahead: 2 }));

		expect(lines).toEqual(["Handoff: branch worktree-x holds 2 commits; its base branch could not be resolved."]);
		expect(lines.join("\n")).not.toContain("git switch");
	});

	test("says so when there is no branch at all", () => {
		expect(handoffLines(handoff({ branch: null }))).toEqual(["Handoff: the worktree had no branch to hand off."]);
	});

	test("carries the real branch and base names into the commands", () => {
		const lines = handoffLines(handoff({ branch: "worktree-hitl-fix", base: "trunk", ahead: 4 })).join("\n");

		expect(lines).toContain("git switch trunk && git merge --no-ff worktree-hitl-fix");
		expect(lines).toContain("gh pr create --head worktree-hitl-fix");
	});
});
