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

describe("the landing proof's append hotspots", () => {
	test("undoes a landing that deletes lines in an append-hotspot", async () => {
		const { git, answer } = landingWith(
			cleanLanding({ "diff --numstat": { stdout: "5\t2\tCHANGELOG.md\n59\t0\tlead-gate.test.ts\n" } }),
		);
		expect(await answer).toMatchObject({ error: expect.stringContaining("deletes lines in CHANGELOG.md") });
		expect(git.argv("reset").at(0)).toEqual(["reset", "--keep", BASE]);
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
