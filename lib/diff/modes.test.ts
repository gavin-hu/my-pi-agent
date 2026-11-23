/**
 * The three comparison scopes: argv per mode.
 *
 * The segmented control's order is asserted by the page that draws it, and the guard
 * that once parsed an untrusted `?mode=` left with the last route that took one.
 */

import { describe, expect, test } from "bun:test";
import { diffArgs } from "./modes.ts";

describe("diff modes", () => {
	test("maps each mode to its revision arguments", () => {
		expect(diffArgs("head")).toEqual(["HEAD"]);
		expect(diffArgs("staged")).toEqual(["--cached"]);
		expect(diffArgs("worktree")).toEqual([]);
	});
});
