/**
 * The Team tab's own contracts, held apart from `pages.test.ts`.
 *
 * `pages.test.ts` is named at its height in `test/suite-sizes.test.ts`, so what the tab's
 * fragment must be true of lives here: the shapes it builds from a session's label, and no
 * question about how a row draws. `behaviour.test.ts` boots the served page for what a reader
 * sees; this holds the bundle-side rule that page depends on, and needs no browser to say it.
 */

import { describe, expect, test } from "bun:test";
import { BOARD_CLIENT_JS } from "./client.ts";

describe("the Team tab's label maps", () => {
	test("keys a session's label without inheriting one", () => {
		// A label is a name a session asks for, so a peer may join as `constructor`. On a plain
		// object that key reads as inherited and truthy, so `seen[key]` dropped the owner's row
		// from the list and the queue called the same owner not running; a null prototype has no
		// members to fall back on, which makes "not written" read as not written.
		expect(BOARD_CLIENT_JS).toContain("function labelMap() { return Object.create(null); }");
		for (const map of ["gone", "owners", "seen"]) {
			expect(BOARD_CLIENT_JS).toContain(`var ${map} = labelMap();`);
			expect(BOARD_CLIENT_JS).not.toContain(`var ${map} = {};`);
		}
	});
});
