/**
 * The kit's one block scan: the boundaries the review's comments hang on, and the
 * structure an emitter reads instead of re-parsing a line.
 *
 * The plan model's own cases (`extensions/plan/plans.test.ts`, "plan block model") hold the
 * splitter's boundaries through the adapter; this suite holds the scan those boundaries come
 * from, and the structure a renderer would otherwise derive again — a heading's level, a
 * fence's info, a table's alignment and cells, a list item's marker and task box.
 */

import { describe, expect, test } from "bun:test";
import { scanBlocks, scanDocument, splitLines } from "./markdown-blocks.ts";

/** `start:end:kind` for each block, so a whole scan is one comparable list. */
function outline(source: string): string[] {
	return scanDocument(source).map((block) => `${block.start}:${block.end}:${block.kind}`);
}

describe("the block scan", () => {
	test("returns no blocks for no lines", () => {
		expect(scanBlocks([])).toEqual([]);
	});

	test("marks blank lines, headings and paragraphs on their own lines", () => {
		expect(outline("a\n\nb")).toEqual(["0:0:paragraph", "1:1:blank", "2:2:paragraph"]);
		expect(outline("# Title\n\n## Goal\ntext")).toEqual(["0:0:heading", "1:1:blank", "2:2:heading", "3:3:paragraph"]);
		expect(outline("one\ntwo\nthree")).toEqual(["0:2:paragraph"]);
	});

	test("keeps a heading's level and text, and needs a space after the hashes", () => {
		const [heading] = scanDocument("### A `step` for C#");
		expect(heading?.kind).toBe("heading");
		expect(heading?.level).toBe(3);
		expect(heading?.text).toBe("A `step` for C#");
		// The shared rule: hashes with no space are prose, not an empty heading.
		expect(outline("#")).toEqual(["0:0:paragraph"]);
	});

	test("gives each list item its own block and keeps continuations with it", () => {
		expect(outline("- one\n- two\n1. three")).toEqual(["0:0:list", "1:1:list", "2:2:list"]);
		expect(outline("- parent\n  - child\n    continuation")).toEqual(["0:0:list", "1:2:list"]);
		expect(outline("- step\n  a note on the step\nnext paragraph")).toEqual(["0:1:list", "2:2:paragraph"]);
	});

	test("reads an item's marker, its indent and its task box", () => {
		const [bullet, numbered, done, open] = scanDocument("- a\n2) b\n- [x] c\n- [ ] d");
		expect(bullet?.item).toEqual({ ordered: false, indent: 0, marker: "-", content: "a", task: null });
		expect(numbered?.item).toEqual({ ordered: true, indent: 0, marker: "2)", content: "b", task: null });
		expect(done?.item?.task).toBe("done");
		// The box is structure, not text: the content is what a reader reads.
		expect(done?.item?.content).toBe("c");
		expect(open?.item?.task).toBe("open");
	});

	test("a list marker wins over a pipe, so a bullet is not a table header", () => {
		// The marker wins at line 0, so the alignment row under it opens nothing: it is prose.
		expect(outline("- | a | b |\n| --- | --- |")).toEqual(["0:0:list", "1:1:paragraph"]);
	});

	test("groups consecutive blockquotes and keeps their text without the markers", () => {
		const [quote] = scanDocument("> one\n> two");
		expect(quote?.kind).toBe("quote");
		expect(quote?.quote).toEqual(["one", "two"]);
		expect(outline("> one\n> two\n\n> three")).toEqual(["0:1:quote", "2:2:blank", "3:3:quote"]);
	});

	test("groups a table and carries its alignment and cells, header first", () => {
		const [table] = scanDocument("| risk | fix |\n| :--- | ---: |\n| slow | cache |");
		expect(table?.kind).toBe("table");
		expect(table?.align).toEqual(["left", "right"]);
		// The delimiter row is structure, not a body row.
		expect(table?.cells).toEqual([
			["risk", "fix"],
			["slow", "cache"],
		]);
		expect(outline("| a |\n| :-: |\n| 1 |\n| 2 |")).toEqual(["0:3:table"]);
		expect(outline("a | b\ntext")).toEqual(["0:1:paragraph"]);
	});

	test("unescapes a pipe inside a cell", () => {
		const [table] = scanDocument("| a | b |\n| --- | --- |\n| x \\| y | z |");
		expect(table?.cells?.[1]).toEqual(["x | y", "z"]);
	});

	test("keeps a rule as a rule and a bare pipe row as prose", () => {
		expect(outline("---")).toEqual(["0:0:hr"]);
		expect(outline("a | b\ntext")).toEqual(["0:1:paragraph"]);
	});

	test("treats a fence as one opaque block and runs an unterminated one to the end", () => {
		expect(outline("```ts\n# not a heading\n- not a step\n```\nafter")).toEqual(["0:3:fence", "4:4:paragraph"]);
		expect(outline("before\n```\nstill code")).toEqual(["0:0:paragraph", "1:2:fence"]);
	});

	test("keeps a fence's marker, its info string and its body", () => {
		const [fence] = scanDocument("~~~sh extra\nrun\n~~~");
		expect(fence?.fence).toEqual({ char: "~", length: 3, info: "sh extra" });
		expect(fence?.body).toEqual(["run"]);
		expect(fence?.lines).toEqual(["~~~sh extra", "run", "~~~"]);
	});

	test("a tab-indented fence is prose for every reader", () => {
		expect(outline("\t```\nbody\n\t```")).toEqual(["0:2:paragraph"]);
	});

	test("splits CRLF, CR and LF the same way", () => {
		expect(splitLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
		expect(outline("a\r\n\r\nb")).toEqual(["0:0:paragraph", "1:1:blank", "2:2:paragraph"]);
	});
});
