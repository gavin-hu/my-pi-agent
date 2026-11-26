/**
 * The comparison vocabulary: what one side of a diff reads, and the argv for one.
 *
 * The three modes' order is asserted by the page that draws it, and the guard that once
 * parsed an untrusted `?mode=` left with the last route that took one.
 */

import { describe, expect, test } from "bun:test";
import { diffArgs, sideArgs } from "./modes.ts";

describe("diff modes", () => {
	test("maps each mode to its revision arguments", () => {
		expect(diffArgs("head")).toEqual(["HEAD"]);
		expect(diffArgs("staged")).toEqual(["--cached"]);
		expect(diffArgs("worktree")).toEqual([]);
	});
});

describe("a comparison's sides", () => {
	test("puts the index and the tree where git reads them", () => {
		expect(sideArgs("main", { kind: "index" })).toEqual(["--cached", "main"]);
		expect(sideArgs(undefined, { kind: "index" })).toEqual(["--cached"]);
		expect(sideArgs("main", { kind: "tree" })).toEqual(["main"]);
		expect(sideArgs(undefined, { kind: "tree" })).toEqual([]);
	});

	test("compares two revisions, or one against the tree", () => {
		expect(sideArgs("main", { kind: "rev", ref: "HEAD" })).toEqual(["main", "HEAD"]);
		expect(sideArgs(undefined, { kind: "rev", ref: "main" })).toEqual(["main"]);
	});
});
