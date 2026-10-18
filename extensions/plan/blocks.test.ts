import { describe, expect, test } from "bun:test";
import { blockAt, codeBody, fenceInfo, planBlocks, type PlanBlockKind } from "./blocks.ts";

/** `start:end:kind` for each block, so a whole parse is one comparable list. */
function outline(plan: string): string[] {
	return planBlocks(plan).map((block) => `${block.start}:${block.end}:${block.kind}`);
}

describe("planBlocks", () => {
	test("returns no blocks for an empty string", () => {
		expect(planBlocks("")).toEqual([]);
	});

	test("marks blank lines as their own single-line blocks", () => {
		expect(outline("a\n\nb")).toEqual(["0:0:paragraph", "1:1:blank", "2:2:paragraph"]);
	});

	test("gives each heading one line", () => {
		expect(outline("# Title\n\n## Goal\ntext")).toEqual(["0:0:heading", "1:1:blank", "2:2:heading", "3:3:paragraph"]);
	});

	test("groups consecutive paragraph lines", () => {
		expect(outline("one\ntwo\nthree")).toEqual(["0:2:paragraph"]);
	});

	test("gives each list item its own block", () => {
		expect(outline("- one\n- two\n1. three")).toEqual(["0:0:list", "1:1:list", "2:2:list"]);
	});

	test("keeps a nested item separate from its parent", () => {
		expect(outline("- parent\n  - child\n    continuation")).toEqual(["0:0:list", "1:2:list"]);
	});

	test("keeps an indented continuation with its list item", () => {
		expect(outline("- step\n  a note on the step\nnext paragraph")).toEqual(["0:1:list", "2:2:paragraph"]);
	});

	test("groups consecutive blockquote lines", () => {
		expect(outline("> one\n> two\n\n> three")).toEqual(["0:1:quote", "2:2:blank", "3:3:quote"]);
	});

	test("groups a table header, alignment row, and body together", () => {
		const plan = "| risk | fix |\n| --- | --- |\n| slow | cache |\nafter";
		expect(outline(plan)).toEqual(["0:2:table", "3:3:paragraph"]);
	});

	test("accepts a table without edge pipes", () => {
		expect(outline("a | b\n--- | ---\n1 | 2")).toEqual(["0:2:table"]);
	});

	test("does not treat a lone pipe row or a bare rule as a table", () => {
		expect(outline("a | b\ntext")).toEqual(["0:1:paragraph"]);
		expect(outline("---")).toEqual(["0:0:hr"]);
	});

	test("keeps the table together when a body row has spaces around pipes", () => {
		expect(outline("| a |\n| :-: |\n| 1 |\n| 2 |")).toEqual(["0:3:table"]);
	});

	test("marks a thematic break as one line", () => {
		expect(outline("text\n\n***\ntext")).toEqual(["0:0:paragraph", "1:1:blank", "2:2:hr", "3:3:paragraph"]);
	});

	test("treats fenced code as one opaque block", () => {
		const plan = "```ts\n# not a heading\n- not a step\n```\nafter";
		expect(outline(plan)).toEqual(["0:3:code", "4:4:paragraph"]);
		expect(planBlocks(plan)[0].kind).toBe<PlanBlockKind>("code");
	});

	test("runs an unterminated fence to the end", () => {
		expect(outline("before\n```\nstill code")).toEqual(["0:0:paragraph", "1:2:code"]);
	});

	test("keeps the fence marker in the block so it can be rewritten verbatim", () => {
		const block = planBlocks("~~~\nbody\n~~~")[0];
		expect(block.lines).toEqual(["~~~", "body", "~~~"]);
	});

	test("strips carriage returns and keeps line numbers aligned", () => {
		expect(outline("a\r\n\r\nb")).toEqual(["0:0:paragraph", "1:1:blank", "2:2:paragraph"]);
		expect(planBlocks("a\r\nb")[0].lines).toEqual(["a", "b"]);
	});

	test("treats a tab-indented fence as prose, the same as the section parser", () => {
		// The fence rule is shared with `steps.ts` and allows up to three spaces; a
		// tab-indented fence must not shift annotation anchors by being code here
		// and prose in the review screen.
		expect(planBlocks("\t```\n- [ ] inside\n\t```\n").some((block) => block.kind === "code")).toBe(false);
	});
});

describe("blockAt", () => {
	const blocks = planBlocks("# Title\ntext\n- one\n- two");

	test("finds the block containing a line", () => {
		expect(blockAt(blocks, 0)?.kind).toBe("heading");
		expect(blockAt(blocks, 1)?.kind).toBe("paragraph");
		expect(blockAt(blocks, 2)?.kind).toBe("list");
		expect(blockAt(blocks, 2)?.start).toBe(2);
	});

	test("falls back to the nearest block before an unknown line", () => {
		expect(blockAt(blocks, 99)?.start).toBe(3);
	});
});

describe("codeBody", () => {
	test("drops the fence lines", () => {
		const block = planBlocks("```ts\nconst x = 1;\n```")[0];
		expect(codeBody(block)).toEqual(["const x = 1;"]);
	});

	test("keeps the body of an unterminated fence", () => {
		expect(codeBody(planBlocks("```\nstill code")[0])).toEqual(["still code"]);
	});

	test("returns a non-code block's lines unchanged", () => {
		expect(codeBody(planBlocks("plain text")[0])).toEqual(["plain text"]);
	});
});

describe("fenceInfo", () => {
	test("extracts the info string after a fence", () => {
		expect(fenceInfo("```ts")).toBe("ts");
		expect(fenceInfo("~~~ python")).toBe("python");
		expect(fenceInfo("plain text")).toBe("");
	});
});
