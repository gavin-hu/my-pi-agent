/**
 * The board's write gate against the two tools it judges by action.
 *
 * `extensions/board/write-gate.ts` names `job` and `watch` and decides by the action a call carries.
 * Their verb lists live in their own modules, and `test/boundaries.test.ts` refuses an extension's
 * tests importing another extension's modules — so the walk that holds the two to each other lives
 * here, the one place allowed to read both. Each tool publishes its verbs as one list, so a new
 * action cannot arrive unclassified: `ACTION_JUDGED` has to name it as a run or as a read, and this
 * case is what says so.
 */

import { describe, expect, test } from "bun:test";
import { ACTION_JUDGED } from "../extensions/board/write-gate.ts";
import { JOB_ACTIONS } from "../extensions/job/types.ts";
import { WATCH_ACTIONS } from "../extensions/watch/types.ts";
import { JOB_TOOL, WATCH_TOOL } from "../lib/tool-names.ts";

describe("the write gate's action table", () => {
	test("classifies every action the two tools publish, and names nothing they do not", () => {
		expect(Object.keys(ACTION_JUDGED).sort()).toEqual([JOB_TOOL, WATCH_TOOL].sort());
		const published: ReadonlyArray<readonly [string, readonly string[]]> = [
			[JOB_TOOL, JOB_ACTIONS],
			[WATCH_TOOL, WATCH_ACTIONS],
		];
		for (const [tool, actions] of published) {
			const judged = ACTION_JUDGED[tool];
			if (judged === undefined) throw new Error(`${tool} is judged by no row at all`);
			// Both halves, so an action dropped from the record is a gap here rather than a silent
			// refusal at run time — the one failure a lane gate must not hide.
			expect([...judged.runs, ...judged.reads].sort()).toEqual([...actions].sort());
		}
	});
});
