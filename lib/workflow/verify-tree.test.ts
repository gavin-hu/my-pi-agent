/**
 * The tree a spot-check runs in: the commit, the branch, which tree of the repository it is, and
 * whether it carries work of its own.
 *
 * `treeOf` is the production reader both review doors hand to `spotCheck`, so its cases drive the
 * git answers a real tree gives — including the one the gate refuses on: a HEAD already in the base.
 */

import { describe, expect, test } from "bun:test";
import { win32 } from "node:path";
import { treeOf } from "./verify.ts";

/** The directory every case reads as: the answers are git's, not a real tree's. */
const CWD = "/repo/billing";

describe("treeOf", () => {
	/** A `pi` whose git answers are the map: the joined args, then what git says. */
	const piAnswering = (answers: Record<string, { stdout: string; code: number }>) => ({
		exec: async (_command: string, args: string[]) => ({
			...(answers[args.join(" ")] ?? { stdout: "", code: 128 }),
			stderr: "",
			killed: false,
			truncated: false,
		}),
	});

	test("names the checkout, its branch, and the commit when git answers", async () => {
		const pi = piAnswering({
			"rev-parse HEAD": { stdout: "1d3a8ce3\n", code: 0 },
			"rev-parse --abbrev-ref HEAD": { stdout: "main\n", code: 0 },
			"rev-parse --path-format=absolute --git-common-dir": { stdout: `${CWD}/.git\n`, code: 0 },
		});
		expect(await treeOf(pi)(CWD)).toEqual({ sha: "1d3a8ce3", branch: "main", checkout: true });
	});

	test("a forward-slash git path and a backslashed cwd name one tree", async () => {
		// Git for Windows prints `--git-common-dir` with forward slashes while a cwd arrives native, so
		// `dirname` keeps one separator and `resolve` answers the other: the checkout was never named
		// there at all. No Windows machine runs this, so the case hands in `win32`'s own two functions.
		const pi = piAnswering({
			"rev-parse HEAD": { stdout: "1d3a8ce3\n", code: 0 },
			"rev-parse --abbrev-ref HEAD": { stdout: "main\n", code: 0 },
			"rev-parse --path-format=absolute --git-common-dir": { stdout: "D:/a/x/.git\n", code: 0 },
		});
		expect(await treeOf(pi, win32)("D:\\a\\x")).toEqual({ sha: "1d3a8ce3", branch: "main", checkout: true });
	});

	test("a worktree is the same git directory under another root, so it is no checkout", async () => {
		// The whole derivation: every tree of one repository shares the git directory, and only the
		// checkout sits where that directory's parent is the root itself.
		const worktree = `${CWD}/.pi/worktrees/x`;
		const pi = piAnswering({
			"rev-parse HEAD": { stdout: "6c1e9a02\n", code: 0 },
			"rev-parse --abbrev-ref HEAD": { stdout: "worktree-x\n", code: 0 },
			"rev-parse --path-format=absolute --git-common-dir": { stdout: `${CWD}/.git\n`, code: 0 },
		});
		expect(await treeOf(pi)(worktree)).toEqual({ sha: "6c1e9a02", branch: "worktree-x" });
	});

	test("asks the base once, and says whether the tree carries anything of its own", async () => {
		const pi = (code: number) =>
			piAnswering({
				"rev-parse HEAD": { stdout: "6c1e9a02\n", code: 0 },
				"rev-parse --abbrev-ref HEAD": { stdout: "worktree-x\n", code: 0 },
				"symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/main\n", code: 0 },
				"merge-base --is-ancestor HEAD main": { stdout: "", code },
			});
		expect(await treeOf(pi(1))(CWD)).toMatchObject({ carries: true, base: "main" });
		// Already in the base: the tree is main, whatever branch it has checked out.
		expect(await treeOf(pi(0))(CWD)).toMatchObject({ carries: false, base: "main" });
		// A read that failed answers nothing, and nothing is refused on a guess.
		expect((await treeOf(pi(128))(CWD)).carries).toBeUndefined();
	});

	test("a detached HEAD is a commit with no branch, and a repository git cannot name is neither", async () => {
		const detached = piAnswering({
			"rev-parse HEAD": { stdout: "1d3a8ce3\n", code: 0 },
			"rev-parse --abbrev-ref HEAD": { stdout: "HEAD\n", code: 0 },
		});
		expect(await treeOf(detached)(CWD)).toEqual({ sha: "1d3a8ce3" });
		// Nothing answers: the record keeps the run and claims no tree, rather than guessing one.
		expect(await treeOf(piAnswering({}))(CWD)).toEqual({});
	});
});
