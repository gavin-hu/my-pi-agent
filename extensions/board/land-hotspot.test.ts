/**
 * The landing proof's append hotspots, as a suite of their own.
 *
 * What this holds is the half a numstat cannot answer: a bullet in `CHANGELOG.md` has no legitimate
 * deletion, while a suite's removal *deletes its manifest line* — the layout gate requires both
 * directions — so the manifest is judged by the declarations it lost, never by the lines a diff
 * removed. A group can sit on one line as `"web-access": ["fetch/extract", "fetch/schema"],`, so a
 * line's first quoted string is the group's key, and reading the diff's prose answers the wrong
 * question in both directions (#905).
 *
 * Split from `land.test.ts` when the wrapped-group cases arrived: the hotspot block was the part
 * growing, and the suite that owned it was 16 lines from the 400-line bar.
 */

import { describe, expect, test } from "bun:test";
import { BASE, cleanLanding, landingWith, MERGE } from "../../test/helpers/land-git.ts";

/** A landing that changes the suite manifest: the two files the proof reads, and the merge's tree. */
/**
 * A landing that changes the suite manifest: the two files the proof reads, and the merge's tree.
 *
 * `patch` is supplied as well as the two texts so a wrapped-group case is faithful to both rules:
 * this suite's proof reads the texts, the superseded one read the diff, and a script answering only
 * one of them could not show which rule a case is holding (#905).
 */
function manifestLanding(options: { before: string; after: string; files: readonly string[]; patch?: string }) {
	return cleanLanding({
		"diff --numstat": { stdout: "5\t0\tCHANGELOG.md\n1\t1\ttest/suite-manifest.ts\n" },
		...(options.patch === undefined ? {} : { "diff --unified=0": { stdout: options.patch } }),
		// The proof reads the base manifest, then the merge's, in that order.
		show: [{ stdout: options.before }, { stdout: options.after }],
		"ls-tree -r": { stdout: `${options.files.join("\n")}\n` },
	});
}

/** A manifest declaring these stems, one per line, as the file spells an unwrapped group. */
function manifest(stems: readonly string[]): string {
	const entries = stems.map((stem) => `\t\t"${stem}",`).join("\n");
	return `export const EXTENSION_SUITES: Record<string, readonly string[]> = {\n\tbytefly: [\n${entries}\n\t],\n};\n`;
}

/** The head of both wrapped-group manifests below: one group, on one line either side. */
const WRAPPED_HEAD = "export const EXTENSION_SUITES: Record<string, readonly string[]> = {\n\t";

/** The hunk header both wrapped-group diffs carry, so a rule reading the diff sees the change. */
const WRAPPED_HUNK = "@@ -1,1 +1,1 @@\n";

/**
 * The changelog patch #909's 0.31.0 prep really makes: the `[Unreleased]` reference rewritten, the new
 * version's line added beneath it, and the new heading above the window. `git diff e386545f 3f7fd000
 * -- CHANGELOG.md` is this, `4/1`, and the allowance exists for exactly this shape.
 */
const RELEASE_PATCH = [
	"@@ -6,6 +6,8 @@",
	"+## [0.31.0] - 2026-11-25",
	"+",
	"@@ -8899,7 +8901,8 @@ one installable Pi package.",
	"-[Unreleased]: https://github.com/gavin-hu/my-pi-agent/compare/v0.30.0...HEAD",
	"+[Unreleased]: https://github.com/gavin-hu/my-pi-agent/compare/v0.31.0...HEAD",
	"+[0.31.0]: https://github.com/gavin-hu/my-pi-agent/compare/v0.30.0...v0.31.0",
	"",
].join("\n");

/** A bullet no landing may drop. */
const BULLET_PATCH = "@@ -10,1 +10,0 @@\n-- `board`: a record nobody may overwrite.\n";

/** The sentence a refused `CHANGELOG.md` deletion prints, byte for byte. */
const APPEND_REFUSAL =
	"the landing deletes lines in CHANGELOG.md, which are appended and not rewritten: the merge was undone and nothing was pushed.";

/** A landing that deletes lines in `CHANGELOG.md`: the counts, and the lines the proof reads. */
function changelogLanding(options: { numstat: string; patch: string }) {
	return cleanLanding({
		"diff --numstat": { stdout: options.numstat },
		"diff --unified=0": { stdout: options.patch },
	});
}

describe("the landing proof's append hotspots", () => {
	test("undoes a landing that deletes a bullet, with the sentence it always printed", async () => {
		// A removed bullet is a peer's record overwritten, and the reference allowance beside it did
		// not reword the case the rule keeps.
		const { git, answer } = landingWith(changelogLanding({ numstat: "5\t2\tCHANGELOG.md\n", patch: BULLET_PATCH }));
		const result = await answer;
		if (!("error" in result)) throw new Error("expected the landing to be refused");
		expect(result.error).toBe(APPEND_REFUSAL);
		expect(git.argv("reset").at(0)).toEqual(["reset", "--keep", BASE]);
		expect(git.argv("push")).toEqual([]);
	});

	test("lands a release prep that rewrites the foot reference and adds the new one", async () => {
		// #909's real shape, `4/1`: a reference is a pointer, so the cut that moves it and adds the
		// new version's line has done what every release does.
		const { git, answer } = landingWith(changelogLanding({ numstat: "4\t1\tCHANGELOG.md\n", patch: RELEASE_PATCH }));
		expect(await answer).toMatchObject({ merge: MERGE });
		expect(git.argv("reset")).toEqual([]);
		expect(git.argv("push")).toHaveLength(1);
	});

	test("undoes a removed reference with nothing replacing it", async () => {
		const { git, answer } = landingWith(
			changelogLanding({
				numstat: "0\t1\tCHANGELOG.md\n",
				patch: "@@ -8899,2 +8899,1 @@\n-[Unreleased]: https://github.com/gavin-hu/my-pi-agent/compare/v0.30.0...HEAD\n",
			}),
		);
		const result = await answer;
		if (!("error" in result)) throw new Error("expected the landing to be refused");
		expect(result.error).toBe(APPEND_REFUSAL);
		expect(git.argv("push")).toEqual([]);
	});

	test("undoes a bullet deleted beside a rewritten reference", async () => {
		// "Every" is the word the rule turns on: one reference in the diff does not excuse the bullet
		// next to it.
		const { git, answer } = landingWith(
			changelogLanding({
				numstat: "4\t2\tCHANGELOG.md\n",
				patch: `${RELEASE_PATCH}-- \`board\`: a record nobody may overwrite.\n`,
			}),
		);
		const result = await answer;
		if (!("error" in result)) throw new Error("expected the landing to be refused");
		expect(result.error).toBe(APPEND_REFUSAL);
		expect(git.argv("push")).toEqual([]);
	});

	test("lands a suite's removal, whose declaration goes and whose file the merge is without", async () => {
		// #903's shape: `footer/budget` leaves the tree, so its declaration leaves the manifest and
		// `panel/settings-scope` takes the slot. The layout gate requires both directions, so the
		// deletion is the suite's own removal rather than an overwritten record.
		const { git, answer } = landingWith(
			manifestLanding({
				before: manifest(["footer/budget", "footer/footer"]),
				after: manifest(["footer/footer", "panel/settings-scope"]),
				files: ["extensions/bytefly/footer/footer.test.ts", "extensions/bytefly/panel/settings-scope.test.ts"],
				patch: '@@ -2,3 +2,3 @@\n-\t\t"footer/budget",\n+\t\t"panel/settings-scope",\n',
			}),
		);
		expect(await answer).toMatchObject({ merge: MERGE });
		expect(git.argv("reset")).toEqual([]);
		expect(git.argv("push")).toHaveLength(1);
	});

	test("undoes a dropped declaration whose suite the merge still carries", async () => {
		// The rewrite the hotspot exists for: another card's record dropped while its subject lives.
		// The refusal names the stem and the file it found, so a reader can see which side is wrong.
		const { git, answer } = landingWith(
			manifestLanding({
				before: manifest(["footer/budget", "footer/footer"]),
				after: manifest(["footer/footer"]),
				files: ["extensions/bytefly/footer/budget.test.ts", "extensions/bytefly/footer/footer.test.ts"],
				patch: '@@ -2,3 +2,2 @@\n-\t\t"footer/budget",\n',
			}),
		);
		const result = await answer;
		if (!("error" in result)) throw new Error("expected the landing to be refused");
		expect(result.error).toContain('"footer/budget" (extensions/bytefly/footer/budget.test.ts)');
		expect(result.error).toContain("the merge was undone");
		expect(git.argv("reset").at(0)).toEqual(["reset", "--keep", BASE]);
		expect(git.argv("push")).toEqual([]);
	});

	test("lands a suite added to a wrapped group, which loses no declaration", async () => {
		// #898's shape: a group that is already one line gains a stem. The line is deleted and
		// replaced by the diff's own account, and no declaration went, so nothing was removed — a
		// rule reading the diff's first quoted string would have taken `"web-access"` for a stem.
		const { git, answer } = landingWith(
			manifestLanding({
				before: `${WRAPPED_HEAD}"web-access": ["fetch/extract"],\n};\n`,
				after: `${WRAPPED_HEAD}"web-access": ["fetch/extract", "fetch/schema"],\n};\n`,
				files: ["extensions/web-access/fetch/extract.test.ts", "extensions/web-access/fetch/schema.test.ts"],
				patch: `${WRAPPED_HUNK}-\t"web-access": ["fetch/extract"],\n+\t"web-access": ["fetch/extract", "fetch/schema"],\n`,
			}),
		);
		expect(await answer).toMatchObject({ merge: MERGE });
		expect(git.argv("reset")).toEqual([]);
		expect(git.argv("push")).toHaveLength(1);
	});

	test("undoes a suite dropped from a wrapped group whose file the merge still has", async () => {
		// The hole the reflow case hides: the same line, one stem lighter, with its file still in
		// the merge. Reading the line's first quoted string saw the key and missed the removal.
		const { git, answer } = landingWith(
			manifestLanding({
				before: `${WRAPPED_HEAD}"web-access": ["fetch/extract", "fetch/schema"],\n};\n`,
				after: `${WRAPPED_HEAD}"web-access": ["fetch/extract"],\n};\n`,
				files: ["extensions/web-access/fetch/extract.test.ts", "extensions/web-access/fetch/schema.test.ts"],
				patch: `${WRAPPED_HUNK}-\t"web-access": ["fetch/extract", "fetch/schema"],\n+\t"web-access": ["fetch/extract"],\n`,
			}),
		);
		const result = await answer;
		if (!("error" in result)) throw new Error("expected the landing to be refused");
		expect(result.error).toContain('"fetch/schema" (extensions/web-access/fetch/schema.test.ts)');
		expect(result.error).toContain("the merge was undone");
		expect(git.argv("push")).toEqual([]);
	});
});
