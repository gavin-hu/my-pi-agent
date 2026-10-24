/**
 * The split rules: what approval refuses, and the merge order it hands the lead.
 *
 * Each case is one rule from the protocol, made mechanical. A refusal names the
 * offending pair, because the answer the user needs is "which two units", not
 * "invalid".
 */

import { describe, expect, test } from "bun:test";
import { checkSplit, MAX_OWNERS, mergeOrder, readSplit, SHARED_FILES, sharedFileFor } from "./split.ts";
import { writeTeam } from "./team.ts";
import type { PlanUnit } from "./team.ts";

function unit(name: string, overrides: Partial<PlanUnit> = {}): PlanUnit {
	return { name, paths: [`src/${name}`], test: `bun test src/${name}`, dependsOn: [], ...overrides };
}

const LEAD = unit("contract", { lead: true, paths: ["src/billing/contract"] });
const CORE = unit("core", { paths: ["src/billing/core"], dependsOn: ["contract"] });
const REPORT = unit("report", { paths: ["src/billing/report"], dependsOn: ["contract"] });

describe("checkSplit", () => {
	test("no units is refused, because approval with none is not this call", () => {
		for (const units of [undefined, []]) {
			const result = checkSplit(units);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.reason).toContain("at least two units");
		}
	});

	test("one unit is refused with the skeleton advice", () => {
		const result = checkSplit([LEAD]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toContain("at least two units");
		expect(result.reason).toContain("thinnest end-to-end path");
	});

	test("lead plus one owner is a pair", () => {
		expect(checkSplit([LEAD, CORE])).toEqual({ ok: true, verdict: "pair", lead: "contract", units: [LEAD, CORE] });
	});

	test("lead plus two owners is a team", () => {
		const result = checkSplit([LEAD, CORE, REPORT]);
		expect(result).toMatchObject({ ok: true, verdict: "team", lead: "contract" });
	});

	test(`more than ${MAX_OWNERS} owners is the split's fault, not the team's size`, () => {
		const result = checkSplit([LEAD, CORE, REPORT, unit("docs")]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toContain(`at most ${MAX_OWNERS} owners`);
	});

	test("an overlapping pair is refused by name", () => {
		const result = checkSplit([LEAD, unit("core", { paths: ["src/billing"] })]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe(
			'Units "contract" and "core" overlap: src/billing/contract and src/billing. Combine them or serialize.',
		);
	});

	test("a unit whose own paths cover each other is refused by name", () => {
		const result = checkSplit([LEAD, unit("core", { paths: ["src/core", "src/core/deep"] })]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toContain('Unit "core" lists paths that cover each other');
	});

	test("an overlap is reported with the two paths that collide, not the first two in the list", () => {
		const result = checkSplit([
			unit("contract", { lead: true, paths: ["src/contract"] }),
			unit("core", { paths: ["src/core", "src/contract/deep"] }),
		]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe(
			'Units "contract" and "core" overlap: src/contract and src/contract/deep. Combine them or serialize.',
		);
	});

	test("a Windows spelling of the same path still collides", () => {
		const result = checkSplit([LEAD, unit("core", { paths: ["src\\billing\\contract"] })]);
		expect(result.ok).toBe(false);
	});

	test("no lead is refused", () => {
		const result = checkSplit([unit("a"), unit("b")]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toContain("No unit is marked as the lead's");
	});

	test("two leads are refused by name", () => {
		const result = checkSplit([unit("a", { lead: true }), unit("b", { lead: true })]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toContain('"a" and "b" are both marked lead');
	});

	test("a unit without a test is refused", () => {
		const result = checkSplit([LEAD, unit("core", { test: "  " })]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('Unit "core" has no test; name the command that proves it.');
	});

	test("a unit without paths is refused", () => {
		const result = checkSplit([LEAD, unit("core", { paths: [] })]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('Unit "core" claims no paths.');
	});

	test("a name that is not a slug is refused", () => {
		const result = checkSplit([LEAD, unit("Core Service")]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toContain("is not a unit name");
	});

	test("two units with one name are refused", () => {
		const result = checkSplit([LEAD, unit("core"), unit("core", { paths: ["test/core"] })]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('Two units are both named "core".');
	});

	test("an owner may not claim a shared file; the lead may", () => {
		const refused = checkSplit([LEAD, unit("core", { paths: ["package.json"] })]);
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.reason).toContain("the lead lands shared files");
		expect(checkSplit([unit("contract", { lead: true, paths: ["package.json"] }), unit("core")]).ok).toBe(true);
	});

	test("the project can extend the shared list", () => {
		const shared = [...SHARED_FILES, "docs/"];
		const result = checkSplit([LEAD, unit("core", { paths: ["docs/guide"] })], shared);
		expect(result.ok).toBe(false);
	});

	test("names the shared file a path covers, for the bus to refuse the same one", () => {
		expect(sharedFileFor("package.json")).toBe("package.json");
		expect(sharedFileFor(".")).toBe("package.json");
		expect(sharedFileFor("docs/extensions/plan.md")).toBeUndefined();
		// A project's own list is a parameter here and nowhere else.
		expect(sharedFileFor("docs/guide", [...SHARED_FILES, "docs/"])).toBe("docs/");
		expect(sharedFileFor("docs/guide")).toBeUndefined();
	});

	test("a dependency on a unit that does not exist is refused", () => {
		const result = checkSplit([LEAD, unit("core", { dependsOn: ["ghost"] })]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('Unit "core" depends on "ghost", which is not a unit.');
	});

	test("a dependency cycle is refused as a path", () => {
		const result = checkSplit([unit("a", { lead: true, dependsOn: ["b"] }), unit("b", { dependsOn: ["a"] })]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("Dependencies loop: a → b → a.");
	});

	test("a value that would break the table is refused", () => {
		const result = checkSplit([LEAD, unit("core", { test: "bun test | tee" })]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toContain("would break the team table");
	});

	test("sibling prefixes are fine, nested ones are not", () => {
		expect(checkSplit([LEAD, unit("core", { paths: ["src/billing/core"] })]).ok).toBe(true);
		expect(checkSplit([LEAD, unit("core", { paths: ["src/billing"] })]).ok).toBe(false);
	});
});

describe("readSplit", () => {
	const plan = (units: PlanUnit[], lead = "contract"): string =>
		writeTeam("# T\n\n## Steps\n\n- [ ] one\n", { lead, units });

	test("reads a table approval would have written", () => {
		expect(readSplit(plan([LEAD, CORE]))).toEqual({ lead: "contract", units: [LEAD, CORE] });
	});

	test("reads nothing from a plan that was never split", () => {
		expect(readSplit("# T\n\n## Steps\n\n- [ ] one")).toBeUndefined();
	});

	test("refuses a section the gate would have refused, so a hand-edited table cannot be joined", () => {
		const overlapping = [LEAD, unit("core", { paths: ["src/billing/contract/deep"] })];
		expect(readSplit(plan(overlapping))).toEqual({
			error:
				'Units "contract" and "core" overlap: src/billing/contract and src/billing/contract/deep. Combine them or serialize.',
		});
		const shared = [LEAD, unit("core", { paths: ["src/core", "package.json"] })];
		expect(readSplit(plan(shared))).toMatchObject({ error: expect.stringContaining("which every workstream touches") });
		const looping = [LEAD, unit("core", { dependsOn: ["report"] }), unit("report", { dependsOn: ["core"] })];
		expect(readSplit(plan(looping))).toMatchObject({ error: expect.stringContaining("Dependencies loop") });
	});

	test("reports the table's own shape errors as they were written", () => {
		expect(readSplit("# T\n\n## Team\n\nLead: a\n")).toEqual({ error: "The team section has no table." });
	});
});

describe("mergeOrder", () => {
	test("puts a dependency before what depends on it", () => {
		expect(mergeOrder([CORE, REPORT, LEAD])).toEqual(["contract", "core", "report"]);
	});

	test("keeps table order for independent units", () => {
		expect(mergeOrder([LEAD, CORE, REPORT])).toEqual(["contract", "core", "report"]);
	});

	test("handles a chain", () => {
		const units = [unit("c", { dependsOn: ["b"] }), unit("b", { dependsOn: ["a"] }), unit("a", { lead: true })];
		expect(mergeOrder(units)).toEqual(["a", "b", "c"]);
	});

	test("ignores a dependency that is not a unit", () => {
		expect(mergeOrder([unit("a", { lead: true }), unit("b", { dependsOn: ["ghost"] })])).toEqual(["a", "b"]);
	});
});
