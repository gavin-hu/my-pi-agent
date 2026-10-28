/**
 * The lane table: the words every surface prints, the ownership and terminal rules
 * `isCard` and the lifecycle read, and the transition matrix the tool generates from.
 *
 * A lane table is only worth having if the surfaces cannot spell a lane a second way, so
 * what is pinned here is the table's shape — one rule per lane, one route per pair, and no
 * route back into the pool or out of `done`.
 */

import { describe, expect, test } from "bun:test";
import { isLane, LANE_RULES, LANES, laneIndex, movableLanes, targetsFrom, transitionOf, TRANSITIONS } from "./lanes.ts";

describe("the lane table", () => {
	test("is the five lanes, in the order every surface reads them", () => {
		expect([...LANES]).toEqual(["backlog", "plan", "execute", "blocked", "done"]);
		expect(laneIndex("backlog")).toBe(0);
		expect(laneIndex("done")).toBe(4);
	});

	test("gives every lane a word, an empty word, and a role", () => {
		for (const lane of LANES) {
			const rule = LANE_RULES[lane];
			expect(rule.label, lane).not.toBe("");
			expect(rule.empty, lane).not.toBe("");
			expect(["muted", "warn", "accent", "danger", "success"]).toContain(rule.role);
		}
	});

	test("has one ownerless lane and one terminal one, which is what the card invariant reads", () => {
		expect(LANES.filter((lane) => LANE_RULES[lane].ownerless)).toEqual(["backlog"]);
		expect(LANES.filter((lane) => LANE_RULES[lane].terminal)).toEqual(["done"]);
		expect(LANES.filter((lane) => LANE_RULES[lane].pulled)).toEqual(["plan", "execute"]);
	});

	test("recognizes a lane, and refuses anything else", () => {
		expect(isLane("execute")).toBe(true);
		expect(isLane("doing")).toBe(false);
		expect(isLane(4)).toBe(false);
		expect(isLane(undefined)).toBe(false);
	});
});

describe("the transitions", () => {
	test("is the flow, and nothing else", () => {
		expect(TRANSITIONS.map((transition) => `${transition.from}->${transition.to}`)).toEqual([
			"backlog->plan",
			"plan->execute",
			"plan->blocked",
			"execute->plan",
			"execute->blocked",
			"execute->done",
			"blocked->plan",
			"blocked->execute",
		]);
	});

	test("carries the gates each route needs", () => {
		expect(transitionOf("plan", "execute")?.needs).toEqual(["contract", "approval"]);
		expect(transitionOf("execute", "done")?.needs).toEqual(["review", "artifact"]);
		expect(transitionOf("plan", "blocked")?.needs).toEqual(["blocker"]);
		expect(transitionOf("blocked", "plan")?.needs).toEqual(["contract-defect"]);
		expect(transitionOf("execute", "plan")?.needs).toEqual([]);
	});

	test("offers no route into the pool and none out of done", () => {
		for (const lane of LANES) expect(transitionOf(lane, "backlog"), lane).toBeUndefined();
		for (const lane of LANES) expect(transitionOf("done", lane), lane).toBeUndefined();
		expect(targetsFrom("backlog")).toEqual(["plan"]);
		expect(targetsFrom("blocked")).toEqual(["plan", "execute"]);
		expect(targetsFrom("done")).toEqual([]);
	});

	test("names the lanes a tool accepts: everything but the pool", () => {
		expect(movableLanes()).toEqual(["plan", "execute", "blocked", "done"]);
	});
});
