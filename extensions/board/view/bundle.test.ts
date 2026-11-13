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
import { duplicateFunctions } from "../../../test/helpers/bundle.ts";
import { BOARD_CLIENT_JS } from "./client.ts";

/** A bundle with one name defined twice: two bodies, or one body twice. */
function bundle(secondBody: string | undefined): string {
	return [
		"(function () {",
		"  function stamp(at) { return at; }",
		"  board.stamp = stamp;",
		...(secondBody === undefined ? [] : [`  function stamp${secondBody}`, "  board.stamp = stamp;"]),
		"})();",
	].join("\n");
}

describe("the bundle's definitions", () => {
	test("has no name carrying two bodies", () => {
		expect(duplicateFunctions(BOARD_CLIENT_JS)).toEqual([]);
	});

	test("fails a name two fragments define, because the concatenation order picks the winner", () => {
		// The hazard, in six lines: which function a caller reaches is the order `client.ts` joins
		// the fragments, and the loser's callers silently answer from the other body.
		expect(duplicateFunctions(bundle("(at, wording) { return wording; }"))).toEqual(["stamp"]);
		expect(duplicateFunctions(bundle(undefined))).toEqual([]);
	});

	test("passes one body carried twice, which is one builder emitted per instance", () => {
		// `keysDialogScript` is `dialogScript` called a second time, so a page with two dialogs
		// carries two copies of one body. Two identical bodies cannot disagree about which answers
		// a caller, and the alternative — naming the allowance — would pin the dialog kit's shape.
		expect(duplicateFunctions(bundle("(at) { return at; }"))).toEqual([]);
	});
});
