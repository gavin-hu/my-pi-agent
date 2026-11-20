/**
 * The three comparison scopes: argv per mode, and the guard on an untrusted value.
 *
 * The segmented control's order is asserted by the page that draws it, so
 * `DIFF_MODES` has no case of its own here.
 */

import { describe, expect, test } from "bun:test";
import { diffArgs, isDiffMode } from "./modes.ts";

describe("diff modes", () => {
	test("maps each mode to its revision arguments", () => {
		expect(diffArgs("head")).toEqual(["HEAD"]);
		expect(diffArgs("staged")).toEqual(["--cached"]);
		expect(diffArgs("worktree")).toEqual([]);
	});

	test("accepts the three modes and rejects anything else", () => {
		expect(isDiffMode("head")).toBe(true);
		expect(isDiffMode("staged")).toBe(true);
		expect(isDiffMode("worktree")).toBe(true);
		expect(isDiffMode("HEAD")).toBe(false);
		expect(isDiffMode("")).toBe(false);
		expect(isDiffMode(null)).toBe(false);
		expect(isDiffMode(undefined)).toBe(false);
	});
});
