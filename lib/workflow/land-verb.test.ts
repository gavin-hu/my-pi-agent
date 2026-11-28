/**
 * The landing verb's staleness guard: the files this process imported, against the files on disk.
 *
 * The defect it answers is a landing that ran the verb its process loaded before board code merged —
 * once in a refusal that misled, once in a merge subject nobody can repair. A suite of its own
 * because `extensions/board/land.test.ts` sits at 397 of its 400 lines, and because this guard is
 * the one refusal `fakeGit` cannot drive: the fingerprint is the seam beside it.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	BRANCH,
	BULLET,
	cleanLanding,
	LANDED,
	landingWith,
	MERGE,
	REVIEWED,
	signedSources,
} from "../../test/helpers/land-git.ts";
import { IMPORTED_LAND_FINGERPRINT, VERB_SOURCES } from "./land-verb.ts";

/** The sentence a refusal answers with, for the two cases that assert its words. */
function errorOf(result: { error: string } | object): string {
	return "error" in result ? result.error : "";
}

describe("the landing's order and its argv", () => {
	// Here rather than in `extensions/board/land.test.ts`, which sits under its 400-line bar: the order
	// is the verb's own fact, and the suite that drives the staleness guard is the one that reads it.
	test("lands a reviewed card: fetch, equality, ancestry, the branch's changelog, merge, proof, push", async () => {
		const { git, written, answer } = landingWith(cleanLanding());
		const result = await answer;
		if ("error" in result) throw new Error(result.error);
		expect(result.merge).toBe(MERGE);
		expect(result.pushed).toBe("origin main");
		expect(result.rows).toEqual([
			{ path: "CHANGELOG.md", added: 2, deleted: 0 },
			{ path: "extensions/board/lead-gate.test.ts", added: 59, deleted: 0 },
		]);
		expect(git.calls.map((args) => args[0])).toEqual([
			"fetch",
			"rev-parse",
			"status",
			"rev-parse",
			"rev-parse",
			"rev-parse",
			// The tree's verb, four files, then the branch's changelog: the reads a stale process must not
			// let itself run past.
			"show",
			"show",
			"show",
			"show",
			"show",
			"show",
			"merge",
			"add",
			"commit",
			"rev-parse",
			"merge-base",
			"diff",
			"show",
			"push",
		]);
		// The merge is the card's subject, the branch the review named, and nothing else — and it is
		// left uncommitted, so the commit that follows carries the bullet the proof reads.
		expect(git.argv("merge").at(0)).toEqual(["merge", "--no-ff", "--no-commit", REVIEWED]);
		expect(git.argv("commit").at(0)).toEqual([
			"commit",
			"-m",
			"merge(board): land is a reviewed card's verb, not a mode exit (#856)",
		]);
		// The write is the file itself, not a description of one: the merge's tree is compared to it.
		expect(written).toEqual([{ path: "/checkout/CHANGELOG.md", text: LANDED }]);
		// A named ref, and never a force.
		expect(git.calls.at(-1)).toEqual(["push", "origin", "main:main"]);
	});
});

describe("the landing verb's fingerprint", () => {
	test("is the files that decide a landing, and every one is what a refusal names", () => {
		// One file is not the judgement: this one decides the merge, `suite-declarations.ts` decides what
		// the merge may delete, and `changelog.ts` decides the one line the landing writes — so a guard
		// that hashed fewer would pass a stale rule, and a stale reader permits the deletion the proof
		// exists to refuse.
		expect(VERB_SOURCES.map((path) => path.split("/").at(-1))).toEqual([
			"land.ts",
			"suite-declarations.ts",
			"changelog.ts",
			"land-subject.ts",
		]);
		// The digest is over *every* read, built here from the files rather than taken from the constant: a
		// guard that hashed one of them would pass a stale reader, which is the half-fix this replaces.
		const expected = createHash("sha256");
		for (const path of VERB_SOURCES) expected.update(readFileSync(path));
		expect(IMPORTED_LAND_FINGERPRINT).toBe(expected.digest("hex"));
	});

	test("refuses a verb that moved since this process imported it, before any merge", async () => {
		const { git, answer } = landingWith(cleanLanding(), () => "moved");
		const result = await answer;
		expect(errorOf(result)).toContain("changed since this process imported them");
		// Both sources, because one digest cannot say which of them moved: naming one would be a guess.
		expect(errorOf(result)).toContain("land.ts");
		expect(errorOf(result)).toContain("suite-declarations.ts");
		// The order is the promise: every refusal a holder can act on has already spoken — the tree's verb
		// and the branch's own changelog included — and nothing is merged or pushed by a process whose
		// rule is stale.
		expect(git.calls.map((args) => args[0])).toEqual([
			"fetch",
			"rev-parse",
			"status",
			"rev-parse",
			"rev-parse",
			"rev-parse",
			"show",
			"show",
			"show",
			"show",
			"show",
			"show",
		]);
		expect(git.argv("merge")).toEqual([]);
		expect(git.argv("push")).toEqual([]);
	});

	test("refuses a verb it could not read, rather than passing it as unchanged", async () => {
		const { git, answer } = landingWith(cleanLanding(), () => undefined);
		const result = await answer;
		expect(errorOf(result)).toContain("could not read the landing verb's own files");
		expect(errorOf(result)).toContain("land.ts");
		expect(errorOf(result)).toContain("suite-declarations.ts");
		expect(git.argv("merge")).toEqual([]);
	});

	test("lands sources the process still holds, and a moved branch keeps its own refusal", async () => {
		const unchanged = await landingWith(cleanLanding(), () => IMPORTED_LAND_FINGERPRINT).answer;
		expect(unchanged).toMatchObject({ merge: MERGE });
		// The branch-tip refusal runs first, so a stale process cannot mask the remedy a holder has:
		// here the seam says "moved" and the answer is still "review it again".
		const moved = await landingWith(
			cleanLanding({ "rev-parse worktree-one": { stdout: `${BRANCH}\n` } }),
			() => "moved",
		).answer;
		expect(errorOf(moved)).toContain("the branch moved past the sign");
	});
});

describe("the verb the signed tree carries", () => {
	/** A tree whose `land.ts` is not the file this process holds. */
	const other = (path: string) =>
		path.endsWith("/land.ts") ? { stdout: "// the verb this tree carries\n" } : undefined;

	test("a tree carrying a different verb lands the line the tree committed, and writes nothing", async () => {
		// The bootstrap path, which is what makes a verb-changing card landable at all: the rules this
		// process holds are not the tree's, so the tree carries its own line, the merge is a plain
		// `--no-ff`, and the equality is the only thing proving the landed file is the right one.
		const { git, written, answer } = landingWith(
			cleanLanding({
				...signedSources(REVIEWED, other),
				[`show ${REVIEWED}:CHANGELOG.md`]: { stdout: LANDED },
				[`show ${MERGE}:CHANGELOG.md`]: { stdout: LANDED },
			}),
		);
		expect(await answer).toMatchObject({ merge: MERGE });
		expect(written).toEqual([]);
		expect(git.argv("merge")).toEqual([
			["merge", "--no-ff", "-m", "merge(board): land is a reviewed card's verb, not a mode exit (#856)", REVIEWED],
		]);
		expect(git.argv("add")).toEqual([]);
		expect(git.argv("commit")).toEqual([]);
	});

	test("a tree carrying a different verb and no line refuses, naming the line, before any merge", async () => {
		// #1018's cost, as a sentence instead of an hour: the merge never runs, and the author is told
		// the exact line to commit and what is owed after.
		const { git, answer } = landingWith(cleanLanding({ ...signedSources(REVIEWED, other) }));
		const result = await answer;
		expect(errorOf(result)).toContain("the signed tree changes the landing verb");
		expect(errorOf(result)).toContain("lib/workflow/land.ts");
		expect(errorOf(result)).toContain(BULLET);
		expect(errorOf(result)).toContain("restart Pi");
		expect(git.argv("merge")).toEqual([]);
		expect(git.argv("push")).toEqual([]);
	});

	test("a tree carrying part of the verb refuses, because neither reading of it is true", async () => {
		const partial = (path: string) => (path.endsWith("/land.ts") ? { code: 128 } : undefined);
		const { git, answer } = landingWith(cleanLanding({ ...signedSources(REVIEWED, partial) }));
		const result = await answer;
		expect(errorOf(result)).toContain("carries part of the landing verb");
		expect(git.argv("merge")).toEqual([]);
	});

	test("a tree that carries none of the verb lands as it did before", async () => {
		// A board whose repository is not this package's: none of these paths was ever there, so the
		// comparison has nothing to say and the verb writes the entry as it always did.
		const { written, answer } = landingWith(
			cleanLanding({ ...signedSources(REVIEWED, () => ({ code: 128, stderr: "fatal: path does not exist in 'x'" })) }),
		);
		expect(await answer).toMatchObject({ merge: MERGE });
		expect(written).toHaveLength(1);
	});
});
