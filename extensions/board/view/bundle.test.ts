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
import { missingBundleBodies, duplicateFunctions } from "../../../test/helpers/bundle.ts";
import { HISTORY_OWNER_JS } from "../../../lib/board/round-text.ts";
import { LABEL_KEY_JS, SAME_LABEL_JS } from "../../../lib/session-label.ts";
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

describe("the fragments' bodies", () => {
	test("carries the one label comparison the history row calls, and the key its maps are written under", () => {
		// `isHistoryOwner` crosses as source and compares two labels through `sameLabel`, and both the
		// roster and active fragments key their maps with `labelKey`. A fragment has no import graph, so
		// every body either calls has to reach the string — the failure is a `ReferenceError` on the
		// first paint with every static check green, which is why both halves are asserted here.
		expect(HISTORY_OWNER_JS).toContain("sameLabel(");
		expect(BOARD_CLIENT_JS).toContain("function sameLabel(");
		expect(BOARD_CLIENT_JS).toContain(SAME_LABEL_JS);
		expect(BOARD_CLIENT_JS).toContain("function labelKey(");
		expect(BOARD_CLIENT_JS).toContain(LABEL_KEY_JS);
	});

	test("fails a spliced body whose helper never reached the string", () => {
		// The hazard the splice above exists for, in four lines: the rule calls a helper, and the
		// bundle that carries the rule would not carry the helper.
		const spliced = `function isHistoryOwner(label, held, roster) { return sameLabel(label, label); }`;
		expect(missingBundleBodies(spliced, ["isHistoryOwner", "sameLabel"])).toEqual(["sameLabel"]);
		expect(missingBundleBodies(`${spliced}\n${SAME_LABEL_JS}`, ["sameLabel"])).toEqual([]);
		// The key half is the same hazard on a map: `owners[labelKey(group.label)]` with no body for
		// `labelKey` is a page that throws where it draws its Agents column.
		const keyed = `function agentRow(group) { return owners[labelKey(group.label)]; }`;
		expect(missingBundleBodies(keyed, ["agentRow", "labelKey"])).toEqual(["labelKey"]);
		expect(missingBundleBodies(`${keyed}\n${LABEL_KEY_JS}`, ["labelKey"])).toEqual([]);
	});
});

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
