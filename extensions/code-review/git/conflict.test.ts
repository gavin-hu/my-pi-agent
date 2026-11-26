/**
 * An unmerged path: what git answers when a file has conflicts, and what the page owes.
 *
 * A real conflicted repository per case, because the two shapes this reads are git's own —
 * a combined `diff --cc` for `index → tree`, and the bare `* Unmerged path` line for
 * `HEAD → index` — and a stub would only restate them.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execP, makeRepo, makeTempTracker, runGit } from "../../../test/helpers/git.ts";
import { comparisonOf } from "../../../test/helpers/review-scope.ts";
import { createReviewReaderFrom } from "./diff.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/**
 * A repository with one file conflicted: `main` and `side` each changed the same line, and the
 * merge that brings them together stopped on it — so the index has three stages and the working
 * tree holds the conflict markers.
 */
async function conflictedRepo(): Promise<string> {
	const repo = temps.track(await makeRepo());
	writeFileSync(join(repo, "f.ts"), "one\ntwo\nthree\n");
	await execP("git", ["add", "f.ts"], { cwd: repo });
	await execP("git", ["commit", "-qm", "add f"], { cwd: repo });
	await execP("git", ["checkout", "-q", "-b", "side"], { cwd: repo });
	writeFileSync(join(repo, "f.ts"), "one\nSIDE\nthree\n");
	await execP("git", ["commit", "-qam", "side"], { cwd: repo });
	await execP("git", ["checkout", "-q", "main"], { cwd: repo });
	writeFileSync(join(repo, "f.ts"), "one\nMAIN\nthree\n");
	await execP("git", ["commit", "-qam", "main"], { cwd: repo });
	const merge = await execP("git", ["merge", "side"], { cwd: repo });
	if (merge.code === 0) throw new Error("the merge was meant to conflict");
	return repo;
}

describe("an unmerged path", () => {
	test("reads as unmerged, with no rows, in the two comparisons git cannot answer two-sided", async () => {
		const repo = await conflictedRepo();
		const reader = createReviewReaderFrom(runGit, repo);
		// `worktree` gets a combined `diff --cc` with three columns, `staged` the bare
		// `* Unmerged path` line: neither is a diff with two sides, so neither has rows.
		const worktree = await reader.snapshot(comparisonOf("worktree"));
		if (worktree.kind !== "snapshot") throw new Error("expected a snapshot");
		const conflicted = worktree.snapshot.files.find((file) => file.rel === "f.ts");
		expect(conflicted?.status).toBe("U");
		expect(conflicted?.unmerged).toBe(true);
		expect(conflicted?.lines).toEqual([]);

		const staged = await reader.snapshot(comparisonOf("staged"));
		if (staged.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(staged.snapshot.files.map((file) => [file.rel, file.status, file.unmerged])).toEqual([["f.ts", "U", true]]);
	});

	test("still reads a real two-way diff where git gives one, markers and all", async () => {
		const repo = await conflictedRepo();
		// A rev-based comparison compares the commit with the tree, which is a two-sided answer:
		// the markers arrive as added lines a reviewer can read and comment on.
		const outcome = await createReviewReaderFrom(runGit, repo).snapshot(comparisonOf("change"));
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		const conflicted = outcome.snapshot.files.find((file) => file.rel === "f.ts");
		expect(conflicted?.unmerged).toBeUndefined();
		expect(conflicted?.lines.some((line) => line.kind === "add" && line.text.startsWith("<<<<<<<"))).toBe(true);
	});

	test("leaves an ordinary snapshot alone", async () => {
		const repo = temps.track(await makeRepo());
		writeFileSync(join(repo, "added.ts"), "export const a = 1;\n");
		await execP("git", ["add", "added.ts"], { cwd: repo });
		const outcome = await createReviewReaderFrom(runGit, repo).snapshot(comparisonOf("uncommitted"));
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(outcome.snapshot.files.map((file) => file.unmerged)).toEqual([undefined]);
	});
});
