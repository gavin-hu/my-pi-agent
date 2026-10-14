import { describe, expect, test } from "bun:test";
import { blockAt, planBlocks, type PlanBlockKind } from "./blocks.ts";

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
