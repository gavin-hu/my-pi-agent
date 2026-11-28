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
import { BRANCH, cleanLanding, landingWith, MERGE } from "../../test/helpers/land-git.ts";
import { IMPORTED_LAND_FINGERPRINT, VERB_SOURCES } from "./land.ts";

/** The sentence a refusal answers with, for the two cases that assert its words. */
function errorOf(result: { error: string } | object): string {
	return "error" in result ? result.error : "";
}

describe("the landing verb's fingerprint", () => {
	test("is the pair of files that decide a landing, and both are what a refusal names", () => {
		// One file is not the judgement: this one decides the merge and `suite-declarations.ts` decides
		// what the merge may delete, so a guard that hashed only the first would pass a stale reader —
		// and a stale reader permits the deletion the proof exists to refuse.
		expect(VERB_SOURCES.map((path) => path.split("/").at(-1))).toEqual(["land.ts", "suite-declarations.ts"]);
		// The digest is over *both* reads, built here from the files rather than taken from the constant: a
		// guard that hashed one of the pair would pass a stale reader, which is the half-fix this replaces.
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
		// The order is the promise: every refusal a holder can act on has already spoken, and nothing
		// is merged or pushed by a process whose rule is stale.
		expect(git.calls.map((args) => args[0])).toEqual([
			"fetch",
			"rev-parse",
			"status",
			"rev-parse",
			"rev-parse",
			"rev-parse",
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
