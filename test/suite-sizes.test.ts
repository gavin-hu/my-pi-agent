/**
 * The suite-size bar, held as a ratchet.
 *
 * `test/README.md` asks for a suite under roughly 400 lines, split by capability once it
 * grows past that. Nothing read that line, so 74 of the declared suites were past it. Each
 * one is named here at its exact line count, and the entries are debt rather than blessings:
 * a `LONG_MODULES` entry claims one responsibility keeps a module whole, while an entry here
 * claims only that the suite has not been split yet.
 *
 * So a named suite may not gain a line, the total may only fall, and a suite past the bar
 * that is not named fails — the answer to a case that needs room is a split, and a split
 * deletes the entry rather than raising it.
 *
 * The count is static and the cases are not: a suite is often table-driven, so lines stand
 * in for the doc's "or 40 tests" half, and the fan-out it would take to count cases is not
 * worth a second number.
 */

import { describe, expect, test } from "bun:test";
import { lineCount } from "./helpers/scan.ts";
import { declaredSuiteFiles } from "./suite-manifest.ts";

/** The bar `test/README.md` states, in lines. */
const SUITE_BAR = 400;

/** Every declared suite past the bar, at its height: debt, and a height only falls. */
const LONG_SUITES: Record<string, number> = {
	"extensions/board/commands.test.ts": 448,
	"extensions/board/page.test.ts": 565,
	"extensions/board/tools.test.ts": 1299,
	"extensions/board/view/behaviour.test.ts": 1127,
	"extensions/board/view/pages.test.ts": 785,
	"extensions/bytefly/block/block.test.ts": 561,
	"extensions/bytefly/chrome.test.ts": 1185,
	"extensions/bytefly/doctor/doctor.test.ts": 511,
	"extensions/bytefly/footer/footer.test.ts": 2280,
	"extensions/bytefly/notify/notify.test.ts": 461,
	"extensions/bytefly/panel/model.test.ts": 429,
	"extensions/bytefly/picker/picker.test.ts": 560,
	"extensions/bytefly/update/update.test.ts": 1176,
	"extensions/check/check.test.ts": 598,
	"extensions/check/surface.test.ts": 1092,
	"extensions/file-browse/files/files.test.ts": 911,
	"extensions/file-browse/transport/router.test.ts": 884,
	"extensions/file-browse/view/pages.test.ts": 1590,
	"extensions/file-read/tool.test.ts": 697,
	"extensions/goal/extension.test.ts": 724,
	"extensions/goal/tools.test.ts": 792,
	"extensions/job/runtime.test.ts": 1727,
	"extensions/job/tools.test.ts": 497,
	"extensions/memory/store.test.ts": 746,
	"extensions/memory/tools.test.ts": 431,
	"extensions/memory/view/memory-picker.test.ts": 423,
	"extensions/plan/commands.test.ts": 826,
	"extensions/plan/extension.test.ts": 493,
	"extensions/plan/feedback.test.ts": 499,
	"extensions/plan/plans.test.ts": 1840,
	"extensions/plan/runtime.test.ts": 422,
	"extensions/plan/tools.test.ts": 1699,
	"extensions/plan/tui.test.ts": 610,
	"extensions/plan/web-behaviour.test.ts": 574,
	"extensions/plan/web-session.test.ts": 427,
	"extensions/plan/web-shared-review.test.ts": 445,
	"extensions/question/view/question-screen.test.ts": 878,
	"extensions/rewind/commands/review.test.ts": 1176,
	"extensions/rewind/state/runtime.test.ts": 1183,
	"extensions/rewind/transport/store.test.ts": 631,
	"extensions/session-bus/extension.test.ts": 411,
	"extensions/session-bus/runtime.test.ts": 959,
	"extensions/session-bus/tools.test.ts": 425,
	"extensions/session-bus/view/session-list.test.ts": 509,
	"extensions/subagent/agents.test.ts": 476,
	"extensions/subagent/extension.test.ts": 783,
	"extensions/subagent/render.test.ts": 617,
	"extensions/subagent/run.test.ts": 1163,
	"extensions/todo/runtime.test.ts": 459,
	"extensions/watch/runtime.test.ts": 519,
	"extensions/watch/view/watch-screen.test.ts": 429,
	"extensions/web-access/fetch/fetch.test.ts": 1181,
	"extensions/web-access/search/search.test.ts": 975,
	"extensions/wechat/bridge.test.ts": 1403,
	"extensions/wechat/commands/commands.test.ts": 1569,
	"extensions/wechat/peer/peer.test.ts": 1681,
	"extensions/wechat/transport/client.test.ts": 945,
	"extensions/wechat/view/status.test.ts": 702,
	"extensions/worktree/flow.test.ts": 825,
	"extensions/worktree/git.test.ts": 893,
	"lib/board/card.test.ts": 406,
	"lib/board/rules.test.ts": 719,
	"lib/board/store.test.ts": 610,
	"lib/board/view.test.ts": 475,
	"lib/core.test.ts": 1045,
	"lib/format.test.ts": 416,
	"lib/requirements.test.ts": 769,
	"lib/tui/interaction.test.ts": 1255,
	"lib/tui/layout.test.ts": 803,
	"lib/tui/tool.test.ts": 458,
	"lib/web/web.test.ts": 810,
	"scripts/screenshots.test.ts": 837,
};

/** The named suites' total, written down so only a split can move it. */
const LONG_SUITE_TOTAL = 59899;

const named = Object.entries(LONG_SUITES).sort(([left], [right]) => left.localeCompare(right));

/** A suite's size, injectable so each check can be exercised on a fixture rather than the tree. */
type SizeOf = (file: string) => number;

/** Suites past the bar with no entry, which is how a new oversized suite is written. */
function unnamedSuites(suites: readonly string[], sizeOf: SizeOf, named: Readonly<Record<string, number>>): string[] {
	return suites
		.filter((file) => sizeOf(file) > SUITE_BAR && named[file] === undefined)
		.map((file) => `${file}: ${sizeOf(file)} lines; split it by capability, or name it in LONG_SUITES`);
}

/** Entries whose file no longer measures what the entry claims. */
function driftedHeights(named: Readonly<Record<string, number>>, sizeOf: SizeOf): string[] {
	return Object.entries(named)
		.filter(([file, lines]) => sizeOf(file) !== lines)
		.map(([file, lines]) => `${file}: named ${lines}, file ${sizeOf(file)}; split the suite, then lower the number`);
}

/** Entries for a suite that is gone, undeclared, or back under the bar. */
function staleEntries(
	named: Readonly<Record<string, number>>,
	declared: ReadonlySet<string>,
	sizeOf: SizeOf,
): string[] {
	return Object.entries(named)
		.filter(([file, lines]) => !declared.has(file) || lines <= SUITE_BAR || sizeOf(file) <= SUITE_BAR)
		.map(([file, lines]) => `${file}: named ${lines}; delete the entry, the suite fits the bar again or is gone`);
}

/** The named suites' total, which only a split may move. */
function namedTotal(named: Readonly<Record<string, number>>): number {
	return Object.values(named).reduce((sum, lines) => sum + lines, 0);
}

describe("suite sizes", () => {
	test("a suite past the bar is named at its height", () => {
		expect(
			unnamedSuites(declaredSuiteFiles(), lineCount, LONG_SUITES),
			"a suite past the bar is a split, or a named debt",
		).toEqual([]);
	});

	test("a named suite keeps its own height", () => {
		// A height above the file would let a few new lines through, which is the growth this
		// gate exists to stop; a height below it would pass while the file shrank.
		expect(driftedHeights(LONG_SUITES, lineCount)).toEqual([]);
	});

	test("the named suites cannot grow in total", () => {
		expect(namedTotal(LONG_SUITES), "the named suites may only fall; split one to lower this").toBeLessThanOrEqual(
			LONG_SUITE_TOTAL,
		);
	});

	test("LONG_SUITES carries no stale entry", () => {
		expect(staleEntries(LONG_SUITES, new Set(declaredSuiteFiles()), lineCount)).toEqual([]);
	});

	test("the ledger is the whole list, and the tree it reads is the one it expects", () => {
		const suites = declaredSuiteFiles();
		// A manifest that stopped being read would make every check above vacuous.
		expect(suites.length).toBeGreaterThan(150);
		expect(suites.filter((file) => lineCount(file) > SUITE_BAR)).toHaveLength(named.length);
		expect(named.length).toBeGreaterThan(60);
	});
});

/** Sizes the fixture checks below read, keyed by `file`; anything else does not exist. */
const sizes =
	(byFile: Record<string, number>): SizeOf =>
	(file) =>
		byFile[file] ?? 0;

describe("the suite-size checks", () => {
	test("fails an oversized suite with no entry", () => {
		const violations = unnamedSuites(
			["extensions/a/big.test.ts"],
			sizes({ "extensions/a/big.test.ts": SUITE_BAR + 1 }),
			{},
		);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("split it by capability");
	});

	test("passes a suite at the bar, which is the bar and not a rounding", () => {
		expect(unnamedSuites(["extensions/a/at.test.ts"], sizes({ "extensions/a/at.test.ts": SUITE_BAR }), {})).toEqual([]);
	});

	test("fails one added line, and fails a shrink that was not recorded", () => {
		const grew = driftedHeights({ "extensions/a/big.test.ts": 500 }, sizes({ "extensions/a/big.test.ts": 501 }));
		const shrank = driftedHeights({ "extensions/a/big.test.ts": 500 }, sizes({ "extensions/a/big.test.ts": 499 }));
		expect(grew).toHaveLength(1);
		expect(grew[0]).toContain("named 500, file 501");
		expect(shrank).toHaveLength(1);
	});

	test("fails an entry for a suite that is gone or back under the bar", () => {
		const declared = new Set(["extensions/a/fits.test.ts"]);
		const gone = staleEntries({ "extensions/a/gone.test.ts": 500 }, declared, sizes({}));
		const fits = staleEntries(
			{ "extensions/a/fits.test.ts": 500 },
			declared,
			sizes({ "extensions/a/fits.test.ts": SUITE_BAR }),
		);
		expect(gone).toHaveLength(1);
		expect(fits).toHaveLength(1);
	});

	test("holds the total to the sum of the heights, so only a split lowers it", () => {
		expect(namedTotal({ a: 500, b: 600 })).toBe(1_100);
	});
});
