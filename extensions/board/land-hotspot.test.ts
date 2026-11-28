/**
 * The landing proof's append hotspots, as a suite of their own.
 *
 * What this holds is the half a numstat cannot answer: the changelog's bullet belongs to the
 * landing, so a branch may not edit the file at all and the reference block at its foot is the one
 * exception — a version cut rewrites those pointers and adds the new version's line. The suite manifest
 * is judged by the declarations it lost, never by the lines a diff removed: the layout gate requires a
 * removal to delete its line, so a group can sit on one line as `"web-access": ["fetch/extract", "fetch/schema"],`
 * and a line's first quoted string is the group's key, while reading the diff's prose answers the wrong
 * question in both directions (#905).
 *
 * Split from `land.test.ts` when the wrapped-group cases arrived: the hotspot block was the part
 * growing, and the suite that owned it was 16 lines from the 400-line bar.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { declaredSuites, suiteFileOf } from "../../lib/workflow/suite-declarations.ts";
import {
	declaredRootSuites,
	declaredSuiteFiles,
	EXTENSION_SUITES,
	LIB_SUITES,
	ROOT_SUITES,
	SCRIPT_SUITES,
} from "../../test/suite-manifest.ts";
import { BASE, BULLET, CHANGELOG, cleanLanding, landingWith, MERGE, REVIEWED } from "../../test/helpers/land-git.ts";

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

/** A manifest with these groups, as the file spells a key (quoted or not) and its stems. */
function groupedManifest(groups: Readonly<Record<string, readonly string[]>>): string {
	const body = Object.entries(groups)
		.map(([key, stems]) => {
			const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `"${key}"`;
			return `\t${name}: [${stems.map((stem) => `"${stem}"`).join(", ")}],`;
		})
		.join("\n");
	return `export const EXTENSION_SUITES: Record<string, readonly string[]> = {\n${body}\n};\n`;
}

/** The head of both wrapped-group manifests below: one group, on one line either side. */
const WRAPPED_HEAD = "export const EXTENSION_SUITES: Record<string, readonly string[]> = {\n\t";

/** The hunk header both wrapped-group diffs carry, so a rule reading the diff sees the change. */
const WRAPPED_HUNK = "@@ -1,1 +1,1 @@\n";

/** The `[Unreleased]` reference a cut rewrites, and the two lines it leaves in its place. */
const CUT_OLD = "[Unreleased]: https://example.com/compare/v0.30.0...HEAD";
const CUT_NEW = [
	"[Unreleased]: https://example.com/compare/v0.31.0...HEAD",
	"[0.31.0]: https://example.com/compare/v0.30.0...v0.31.0",
].join("\n");

/** The file a landing leaves behind when the branch's copy is `branch`: this card's bullet above its list. */
function landedFrom(branch: string): string {
	return branch.replace("- an earlier change\n", `${BULLET}\n\n- an earlier change\n`);
}

/** A landing whose branch carries `branch` as its changelog, and a merge that carries the bullet. */
function changelogLanding(branch: string) {
	return cleanLanding({
		[`show ${REVIEWED}:CHANGELOG.md`]: { stdout: branch },
		[`show ${MERGE}:CHANGELOG.md`]: { stdout: landedFrom(branch) },
	});
}

describe("the landing proof's append hotspots", () => {
	test("lands a version cut, whose reference rewrite is the one edit a branch may make", async () => {
		// #909's shape: a reference is a pointer, so the cut that moves it and adds the new version's line
		// has done what every release does — and the bullet still rides above it, written by the landing.
		const cut = CHANGELOG.replace(CUT_OLD, CUT_NEW);
		const { git, written, answer } = landingWith(changelogLanding(cut));
		expect(await answer).toMatchObject({ merge: MERGE });
		expect(written.at(0)?.text).toBe(landedFrom(cut));
		expect(git.argv("push")).toHaveLength(1);
	});

	test("refuses a branch that deletes a peer's bullet, before any merge", async () => {
		// The contention this verb exists to remove, caught where it costs a sentence rather than a
		// conflict: a branch's changelog is the base's, except for the references a cut rewrites.
		const { git, answer } = landingWith(changelogLanding(CHANGELOG.replace("- an earlier feature\n\n", "")));
		const result = await answer;
		if (!("error" in result)) throw new Error("expected the landing to be refused");
		expect(result.error).toContain("the branch edits CHANGELOG.md");
		expect(result.error).toContain(BULLET);
		expect(git.argv("merge")).toEqual([]);
		expect(git.argv("push")).toEqual([]);
	});

	test("refuses a reference removed with nothing replacing it", async () => {
		// A cut adds the version line as well as moving the pointer; a reference that only disappears is
		// a record lost rather than a release cut.
		const { git, answer } = landingWith(changelogLanding(CHANGELOG.replace(`${CUT_OLD}\n`, "")));
		const result = await answer;
		if (!("error" in result)) throw new Error("expected the landing to be refused");
		expect(result.error).toContain("without the new version's line");
		expect(git.argv("merge")).toEqual([]);
	});

	test("refuses a cut that drops a bullet beside the reference it rewrote", async () => {
		// "Except the references" is the whole allowance: one reference in the diff does not excuse the
		// bullet next to it, and the comparison is what says so without reading a single diff line.
		const cut = CHANGELOG.replace(CUT_OLD, CUT_NEW).replace("- an earlier feature\n\n", "");
		const { git, answer } = landingWith(changelogLanding(cut));
		const result = await answer;
		if (!("error" in result)) throw new Error("expected the landing to be refused");
		expect(result.error).toContain("the branch edits CHANGELOG.md");
		expect(git.argv("merge")).toEqual([]);
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

	test("lands a rename whose old stem another group also spells", async () => {
		// #992's shape, which blocked the landing: `presence` leaves `session-bus` for `record`, and
		// `wechat` declares the stem `conversation/presence` — a different declaration that happens to
		// end with the same file basename. The group is what decides which file answers.
		const { git, answer } = landingWith(
			manifestLanding({
				before: groupedManifest({ "session-bus": ["presence", "record"], wechat: ["conversation/presence"] }),
				after: groupedManifest({ "session-bus": ["record"], wechat: ["conversation/presence"] }),
				files: ["extensions/session-bus/record.test.ts", "extensions/wechat/conversation/presence.test.ts"],
				patch: '@@ -2,5 +2,4 @@\n-\t"session-bus": ["presence", "record"],\n+\t"session-bus": ["record"],\n',
			}),
		);
		expect(await answer).toMatchObject({ merge: MERGE });
		expect(git.argv("reset")).toEqual([]);
		expect(git.argv("push")).toHaveLength(1);
	});

	test("undoes a declaration dropped while its own group's file survives", async () => {
		// The bias the fix must keep: the stem is gone from `session-bus` and its file is still in the
		// merge — a rewritten record, whatever another group declares.
		const { git, answer } = landingWith(
			manifestLanding({
				before: groupedManifest({ "session-bus": ["presence"], wechat: ["conversation/presence"] }),
				after: groupedManifest({ wechat: ["conversation/presence"] }),
				files: ["extensions/session-bus/presence.test.ts", "extensions/wechat/conversation/presence.test.ts"],
				patch: '@@ -2,2 +2,1 @@\n-\t"session-bus": ["presence"],\n',
			}),
		);
		const result = await answer;
		if (!("error" in result)) throw new Error("expected the landing to be refused");
		expect(result.error).toContain('"presence" (extensions/session-bus/presence.test.ts)');
		expect(git.argv("reset").at(0)).toEqual(["reset", "--keep", BASE]);
		expect(git.argv("push")).toEqual([]);
	});

	test("reads a note inside the manifest as a note, not as a declaration", async () => {
		// A note may hold the brackets the scan is looking for. Without comment state the group's
		// array ends at the `]` in the note, so the declaration it held reads as nothing, no removal
		// is seen, and the deletion below is allowed — the silent direction.
		const before = [
			"export const EXTENSION_SUITES: Record<string, readonly string[]> = {",
			"\t// a group is written `key: [` in this file",
			'\t"session-bus": [ // this ] closes nothing',
			'\t\t"presence",',
			"\t],",
			'\twechat: ["conversation/presence"], /* a block note with ] too */',
			"};",
			"",
		].join("\n");
		const after = before.replace('\t\t"presence",\n', "");
		const { git, answer } = landingWith(
			manifestLanding({
				before,
				after,
				files: ["extensions/session-bus/presence.test.ts", "extensions/wechat/conversation/presence.test.ts"],
				patch: '@@ -3,3 +3,2 @@\n-\t\t"presence",\n',
			}),
		);
		const result = await answer;
		if (!("error" in result)) throw new Error("expected the landing to be refused");
		expect(result.error).toContain('"presence" (extensions/session-bus/presence.test.ts)');
		expect(git.argv("push")).toEqual([]);
	});

	test("reads the manifest this repository ships, and resolves it to the layout's own paths", () => {
		// The copy of the four shapes is bound to the original here: the guard's reader and resolver
		// must reproduce `declaredSuiteFiles` and `declaredRootSuites` from the same text, or the two
		// readers have drifted and only this case notices.
		const text = readFileSync(new URL("../../test/suite-manifest.ts", import.meta.url), "utf8");
		const declared = declaredSuites(text);
		if (declared === undefined) throw new Error("the guard could not read the manifest it ships with");
		const paths = new Set(declared.map((entry) => suiteFileOf(entry.owner, entry.stem)));
		const expected = [...declaredSuiteFiles(), ...declaredRootSuites()];
		expect([...paths].filter((path) => !expected.includes(path))).toEqual([]);
		expect(expected.filter((path) => !paths.has(path))).toEqual([]);
		const count =
			Object.values(EXTENSION_SUITES).reduce((total, stems) => total + stems.length, 0) +
			LIB_SUITES.length +
			SCRIPT_SUITES.length +
			ROOT_SUITES.length;
		expect(declared).toHaveLength(count);
	});

	test("undoes a landing when the manifest's groups cannot be read", async () => {
		// A guard that cannot read the layout must not allow a deletion: this base's object never
		// closes, so no declaration can be attributed and the landing refuses instead of reading the
		// file as declaring nothing.
		const before =
			'export const EXTENSION_SUITES: Record<string, readonly string[]> = {\n\tbytefly: [\n\t\t"footer/budget",\n\t],\n';
		const { git, answer } = landingWith(
			manifestLanding({ before, after: before, files: [], patch: "@@ -2,3 +2,2 @@\n" }),
		);
		const result = await answer;
		if (!("error" in result)) throw new Error("expected the landing to be refused");
		expect(result.error).toContain("could not read the groups test/suite-manifest.ts declares");
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
