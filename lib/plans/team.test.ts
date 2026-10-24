/**
 * The `## Team` section as a wire format: what approval writes and what a joining
 * session reads.
 */

import { describe, expect, test } from "bun:test";
import { parseTeam, readTeam, renderTeam, unsafeValue, writeTeam, type PlanUnit } from "./team.ts";

function unit(name: string, overrides: Partial<PlanUnit> = {}): PlanUnit {
	return { name, paths: [`src/${name}`], test: `bun test src/${name}`, dependsOn: [], ...overrides };
}

const TEAM = { lead: "contract", units: [unit("contract", { lead: true }), unit("core", { dependsOn: ["contract"] })] };

describe("renderTeam", () => {
	test("renders a lead line and a table the review screen can draw", () => {
		expect(renderTeam(TEAM)).toBe(
			[
				"Lead: contract",
				"",
				"| unit | paths | test | depends on |",
				"| --- | --- | --- | --- |",
				"| contract | src/contract | bun test src/contract | — |",
				"| core | src/core | bun test src/core | contract |",
			].join("\n"),
		);
	});

	test("joins several paths and dependencies with commas", () => {
		const body = renderTeam({
			lead: "a",
			units: [unit("a", { lead: true, paths: ["src/a", "lib/a"] }), unit("b", { dependsOn: ["a", "c"] })],
		});
		expect(body).toContain("| a | src/a, lib/a |");
		expect(body).toContain("| a, c |");
	});

	test("flags a value that would break the table", () => {
		expect(unsafeValue({ lead: "a", units: [unit("a", { lead: true, test: "bun test | tee" })] })).toBe(
			"bun test | tee",
		);
		expect(unsafeValue(TEAM)).toBeUndefined();
	});
});

describe("parseTeam", () => {
	test("round-trips what renderTeam writes", () => {
		const parsed = parseTeam(renderTeam(TEAM));
		expect(parsed).toEqual(TEAM);
	});

	test("drops backticks and padding", () => {
		const body = [
			"Lead: contract",
			"",
			"| unit | paths | test | depends on |",
			"| --- | --- | --- | --- |",
			"| `contract` | `src/a`, `src/b` | `bun test src/a` | — |",
			"| core | src/c | bun test src/c | contract |",
		].join("\n");
		expect(parseTeam(body)).toEqual({
			lead: "contract",
			units: [
				{ name: "contract", paths: ["src/a", "src/b"], test: "bun test src/a", dependsOn: [], lead: true },
				{ name: "core", paths: ["src/c"], test: "bun test src/c", dependsOn: ["contract"] },
			],
		});
	});

	test("tolerates a table without a depends-on column", () => {
		const body = [
			"Lead: a",
			"",
			"| unit | paths | test |",
			"| --- | --- | --- |",
			"| a | src/a | bun test src/a |",
			"| b | src/b | bun test src/b |",
		].join("\n");
		expect(parseTeam(body)).toEqual({
			lead: "a",
			units: [unit("a", { lead: true }), unit("b")],
		});
	});

	test("refuses a section with no lead line", () => {
		expect(parseTeam("| unit | paths | test |\n| --- | --- | --- |\n| a | src/a | bun test |")).toEqual({
			error: "The team section has no `Lead: <unit>` line.",
		});
	});

	test("refuses a lead that is not a unit", () => {
		expect(parseTeam(renderTeam({ lead: "ghost", units: [unit("a")] }))).toEqual({
			error: 'The lead "ghost" is not one of the units.',
		});
	});

	test("refuses a row without paths or a test", () => {
		expect(parseTeam("Lead: a\n\n| unit | paths | test |\n| --- | --- | --- |\n| a |  | bun test |")).toEqual({
			error: 'Unit "a" lists no paths.',
		});
		expect(parseTeam("Lead: a\n\n| unit | paths | test |\n| --- | --- | --- |\n| a | src/a |  |")).toEqual({
			error: 'Unit "a" lists no test.',
		});
	});

	test("refuses a unit name that is not a slug", () => {
		expect(parseTeam("Lead: A\n\n| unit | paths | test |\n| --- | --- | --- |\n| A | src/a | bun test |")).toEqual({
			error: '"A" is not a unit name.',
		});
	});

	test("refuses a table missing a required column", () => {
		expect(parseTeam("Lead: a\n\n| unit | paths |\n| --- | --- |\n| a | src/a |")).toEqual({
			error: "The team table needs `unit`, `paths`, and `test` columns.",
		});
	});

	test("refuses an empty table", () => {
		expect(parseTeam("Lead: a")).toEqual({ error: "The team section has no table." });
	});
});

describe("readTeam and writeTeam", () => {
	test("writes the section into a plan that has none", () => {
		const plan = writeTeam("# T\n\n## Steps\n\n- [ ] one\n", TEAM);
		expect(plan).toContain("## Team");
		expect(readTeam(plan)).toEqual(TEAM);
	});

	test("replaces the section on a second write", () => {
		const once = writeTeam("# T\n\n## Steps\n\n- [ ] one\n", TEAM);
		const twice = writeTeam(once, { lead: "core", units: [unit("core", { lead: true }), unit("report")] });
		expect(twice.match(/## Team/g)).toHaveLength(1);
		expect(readTeam(twice)).toEqual({ lead: "core", units: [unit("core", { lead: true }), unit("report")] });
	});

	test("reads undefined from a plan that was never split", () => {
		expect(readTeam("# T\n\n## Steps\n\n- [ ] one")).toBeUndefined();
	});

	test("refuses a hand-edited section instead of half-reading it", () => {
		expect(readTeam("# T\n\n## Team\n\nLead: a\n")).toEqual({ error: "The team section has no table." });
	});

	test("returns every path a joined unit owns, and nothing else", () => {
		const plan = writeTeam("# T\n\n## Steps\n\n- [ ] one\n", {
			lead: "a",
			units: [unit("a", { lead: true }), unit("b", { paths: ["src/b", "lib/b"] })],
		});
		const team = readTeam(plan);
		if (team === undefined || "error" in team) throw new Error("expected a team");
		expect(team.units.find((entry) => entry.name === "b")?.paths).toEqual(["src/b", "lib/b"]);
	});
});
