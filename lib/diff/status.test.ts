/**
 * The status parse and the three readings of a changed path.
 *
 * Every case here moved with the body from the browse suite, unchanged.
 */

import { describe, expect, test } from "bun:test";
import { type ChangedFile, changeDirs, inMode, parseStatusZ, statusLetter } from "./status.ts";

const changed = (partial: Partial<ChangedFile>): ChangedFile => ({
	rel: "x",
	index: " ",
	worktree: " ",
	untracked: false,
	...partial,
});

describe("status parsing", () => {
	test("parses staged, unstaged, and untracked entries", () => {
		expect(parseStatusZ(" M a.txt\0M  b.txt\0MM c.txt\0?? new file.txt\0")).toEqual([
			{ rel: "a.txt", index: " ", worktree: "M", untracked: false },
			{ rel: "b.txt", index: "M", worktree: " ", untracked: false },
			{ rel: "c.txt", index: "M", worktree: "M", untracked: false },
			{ rel: "new file.txt", index: "?", worktree: "?", untracked: true },
		]);
	});

	test("reads a rename as destination then original", () => {
		expect(parseStatusZ("R  new.txt\0old.txt\0")).toEqual([
			{ rel: "new.txt", origRel: "old.txt", index: "R", worktree: " ", untracked: false },
		]);
	});

	test("parses deleted entries on either side", () => {
		expect(parseStatusZ(" D gone.txt\0D  staged-gone.txt\0")).toEqual([
			{ rel: "gone.txt", index: " ", worktree: "D", untracked: false },
			{ rel: "staged-gone.txt", index: "D", worktree: " ", untracked: false },
		]);
	});

	test("skips malformed or empty records", () => {
		expect(parseStatusZ("short\0\0 M ok.txt\0")).toEqual([
			{ rel: "ok.txt", index: " ", worktree: "M", untracked: false },
		]);
	});

	test("prefers the index letter and marks untracked", () => {
		expect(statusLetter(changed({ index: "M" }))).toBe("M");
		expect(statusLetter(changed({ worktree: "D" }))).toBe("D");
		expect(statusLetter(changed({ index: "M", worktree: "M" }))).toBe("M");
		expect(statusLetter(changed({ untracked: true, index: "?", worktree: "?" }))).toBe("?");
	});

	test("filters by the column each mode compares", () => {
		expect(inMode(changed({ worktree: "M" }), "worktree")).toBe(true);
		expect(inMode(changed({ index: "M" }), "worktree")).toBe(false);
		expect(inMode(changed({ index: "M" }), "staged")).toBe(true);
		expect(inMode(changed({ worktree: "M" }), "staged")).toBe(false);
		expect(inMode(changed({ untracked: true, index: "?", worktree: "?" }), "worktree")).toBe(true);
		expect(inMode(changed({ untracked: true, index: "?", worktree: "?" }), "staged")).toBe(false);
		expect(inMode(changed({ index: "M" }), "head")).toBe(true);
	});

	test("collects every ancestor directory without the file itself", () => {
		expect([...changeDirs([changed({ rel: "a.ts" })])]).toEqual([]);
		expect([...changeDirs([changed({ rel: "x/y/z.ts" })])].sort()).toEqual(["x", "x/y"]);
		expect(
			[...changeDirs([changed({ rel: "x/a.ts" }), changed({ rel: "x/y/b.ts" }), changed({ rel: "c.ts" })])].sort(),
		).toEqual(["x", "x/y"]);
		expect(changeDirs([]).size).toBe(0);
	});
});
