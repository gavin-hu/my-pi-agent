/**
 * A landing end to end, in a real repository: the merge, the written bullet, and the proof.
 *
 * The scripted suites pin the order of the commands; this one pins the thing an order cannot say —
 * that `merge --no-commit`, a written file, `add` and `commit` leave exactly one merge whose
 * `CHANGELOG.md` is the base's with this card's bullet in it, and that the same verb refuses a branch
 * that wrote its own before it merges anything. Real git, so both answers are git's rather than a
 * fake's, which is what the ordering refusal in `land.ts` is worth only if this holds.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Card } from "../../lib/workflow/card.ts";
import { landCard } from "../../lib/workflow/land.ts";
import { boardCard } from "../../test/helpers/fixtures/board.ts";
import { execP, makeRepoWithRemote, makeTempTracker, runGit } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** The changelog every card starts from: one window, one section, and no `Changed` for the bullet. */
const CHANGELOG = ["# Clog", "", "## [Unreleased]", "", "### Added", "", "- shipped", ""].join("\n");

/** The card every case lands: no type, so its bullet belongs under `Changed`, which the file lacks. */
const CARD: Card = boardCard("7", { title: "board: a card lands with its bullet", paths: ["lib/workflow/land.ts"] });

/** The line the landing is expected to write, spelled here rather than taken from `landBullet`. */
const BULLET = "- `board`: a card lands with its bullet (#7)";

/** `git` in `cwd`, for the setup a case needs before the verb runs. */
async function git(args: string[], cwd: string): Promise<string> {
	const result = await execP("git", args, { cwd });
	if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	return result.stdout;
}

/**
 * A repository on `main`, level with its remote, and a branch the review could have named.
 *
 * The branch carries `branchFile`'s body, which is how a case gives it a changelog of its own: the
 * point of the card is that a landing, not a branch, is what writes that file.
 */
async function readyRepo(branchChangelog?: string): Promise<{ repo: string; sha: string; branch: string }> {
	const { repo } = await makeRepoWithRemote("pi-land-changelog-");
	writeFileSync(join(repo, "CHANGELOG.md"), CHANGELOG);
	await git(["add", "CHANGELOG.md"], repo);
	await git(["commit", "-qm", "the changelog every card edits"], repo);
	await git(["push", "-q", "origin", "main"], repo);
	await git(["checkout", "-q", "-b", "worktree-seven"], repo);
	writeFileSync(join(repo, "own.ts"), "export const own = 1;\n");
	await git(["add", "own.ts"], repo);
	if (branchChangelog !== undefined) {
		writeFileSync(join(repo, "CHANGELOG.md"), branchChangelog);
		await git(["add", "CHANGELOG.md"], repo);
	}
	await git(["commit", "-qm", "the card's own work"], repo);
	const sha = (await git(["rev-parse", "HEAD"], repo)).trim();
	await git(["checkout", "-q", "main"], repo);
	return { repo, sha, branch: "worktree-seven" };
}

/** Land {@link CARD} in `repo`, as the seat does: the review's own evidence, and the production seam. */
function land(repo: string, sha: string, branch: string) {
	return landCard({ card: CARD, cwd: repo, reviewed: { sha, branch }, run: runGit });
}

describe("a landing in a real repository", () => {
	test("one merge whose changelog is the base's with this card's bullet, pushed as a named ref", async () => {
		const { repo, sha, branch } = await readyRepo();
		const answer = await land(repo, sha, branch);
		if ("error" in answer) throw new Error(answer.error);

		// The merge carries the signed tree, and the bullet is the whole of what this verb added.
		expect((await git(["merge-base", "--is-ancestor", sha, answer.merge], repo)).trim()).toBe("");
		// Four lines, because the section is created as well as filled: the heading, its space, the
		// bullet, and the blank line a window keeps above nothing.
		expect(answer.rows).toEqual([
			{ path: "CHANGELOG.md", added: 4, deleted: 0 },
			{ path: "own.ts", added: 1, deleted: 0 },
		]);
		const landed = await git(["show", `${answer.merge}:CHANGELOG.md`], repo);
		expect(landed).toBe(`${CHANGELOG.slice(0, -1)}\n\n### Changed\n\n${BULLET}\n`);
		// The subject names the card, and the branch is pushed under its own name rather than to HEAD.
		expect(answer.subject).toBe("merge(board): a card lands with its bullet (#7)");
		expect(answer.pushed).toBe("origin main");
		expect((await git(["rev-parse", "origin/main"], repo)).trim()).toBe(answer.merge);
	});

	test("refuses a branch that wrote its own bullet, before it merges anything", async () => {
		// The contention the card removes, caught at its cheapest point: the checkout still holds the
		// branch's commit and nothing else, so the author can drop the line and land again.
		const { repo, sha, branch } = await readyRepo(`${CHANGELOG}- a bullet the branch typed itself\n`);
		const before = (await git(["rev-parse", "HEAD"], repo)).trim();
		const answer = await land(repo, sha, branch);
		if (!("error" in answer)) throw new Error("expected the landing to be refused");
		expect(answer.error).toContain("the branch edits CHANGELOG.md");
		expect(answer.error).toContain(BULLET);
		// Nothing was merged, written or pushed: the checkout is where it was.
		expect((await git(["rev-parse", "HEAD"], repo)).trim()).toBe(before);
		expect((await git(["status", "--porcelain"], repo)).trim()).toBe("");
		expect((await git(["rev-parse", "origin/main"], repo)).trim()).toBe(before);
		// And the branch's own copy is untouched: nothing was written to it, and nothing landed from it.
		expect(await git(["show", `${sha}:CHANGELOG.md`], repo)).toContain("a bullet the branch typed itself");
	});
});
