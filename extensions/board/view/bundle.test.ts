/**
 * The client bundle's own bookkeeping: a helper has one body and one publication.
 *
 * Two fragments that each define `stamp` and each publish it under `board.stamp` make the order in
 * which `client.ts` concatenates them load-bearing — two lines moved and every Team-tab age printed
 * `undefined`. `view/pages.test.ts` holds the bundle's overall shape and is at its named height, so
 * the guard for that hazard has its own suite, with a synthetic bundle that proves it bites rather
 * than only asserting the real one is clean.
 */

import { describe, expect, test } from "bun:test";
import { duplicateDefinitions } from "../../../test/helpers/bundle.ts";
import { BOARD_CLIENT_JS } from "./client.ts";

/** A bundle with one publication, and with two definitions of the name it publishes. */
function bundle(secondDefinition: boolean): string {
	return [
		"(function () {",
		"  function stamp(at) { return at; }",
		"  board.stamp = stamp;",
		...(secondDefinition ? ["  function stamp(at, wording) { return wording; }", "  board.stamp = stamp;"] : []),
		"})();",
	].join("\n");
}

describe("the bundle's definitions", () => {
	test("has none published twice", () => {
		expect(duplicateDefinitions(BOARD_CLIENT_JS)).toEqual([]);
	});

	test("fails a name two fragments define and publish", () => {
		// The hazard, in six lines: which function a caller reaches is the concatenation order.
		expect(duplicateDefinitions(bundle(true))).toEqual(["stamp"]);
		expect(duplicateDefinitions(bundle(false))).toEqual([]);
	});
});
