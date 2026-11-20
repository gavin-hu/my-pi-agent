/**
 * The gate's plan: which chain a `check` runs, and why it is that one.
 *
 * The subject here is a decision rather than a process — `planFor` is pure, so what the gate would
 * run is a case and not a comment. What the cases hold, in order of what breaks quietly:
 *
 * - **the ordinary plan is exactly four commands** — format, types, `--changed=main`, and the `test/`
 *   sweeps. Without this one a later edit can drop a step and every other case still passes, which is
 *   the failure #745 exists to prevent: a `check` that has quietly become the fast half.
 * - **format and types are in every plan**, asked for or widened anyway, because they are what a
 *   landing owes whatever the tests cost.
 * - **the budget rides every test command**, so a narrower plan cannot lose the timeout the one
 *   `CASE_BUDGET_MS` states.
 * - **each widening has its own case**: `--all`, no branch diff, a runner file, and a `git` read that
 *   failed. The last is the one where a wrong answer silently skips the suites a change selects.
 */

import { describe, expect, test } from "bun:test";
import { CASE_BUDGET_MS } from "../test/helpers/budget.ts";
import { display, type Facts, planFor, RUNNER_FILES } from "./check.ts";

/** A branch that changed one leaf module. */
const LEAF: Facts = { changed: ["lib/workflow/verify.ts"] };

/** The commands as `display` spells them, which is what a reader sees and what a case can read. */
function lines(facts: Facts): string[] {
	return planFor(facts).commands.map((command) => display(command));
}

/** Every `bun test` line in a plan, so the budget can be asked of all of them. */
function testLines(facts: Facts): string[] {
	return lines(facts).filter((line) => line.startsWith("bun test"));
}

describe("the ordinary gate", () => {
	test("is format, types, this branch's suites, and the sweeps", () => {
		expect(lines(LEAF)).toEqual([
			"bun run check:format",
			"bun run check:types",
			"bun test --timeout 90000 --changed=main",
			"bun test --timeout 90000 test/",
		]);
	});

	test("says nothing about widening, because it did not widen", () => {
		expect(planFor(LEAF).why).toBeUndefined();
	});

	test("keeps the sweeps, which no import graph can select", () => {
		// The tree contracts read files rather than import them, so `--changed` cannot see them. Dropping
		// this command would leave a docs change gated by nothing at all.
		expect(testLines(LEAF)).toContain("bun test --timeout 90000 test/");
	});
});

describe("every plan", () => {
	const plans: Array<[string, Facts]> = [
		["the ordinary branch", LEAF],
		["--all", { all: true, changed: ["lib/workflow/verify.ts"] }],
		["no branch diff", { changed: [] }],
		["a runner change", { changed: ["package.json"] }],
		["an unreadable diff", { changed: undefined }],
		["nothing known at all", {}],
	];

	for (const [what, facts] of plans) {
		test(`${what} starts with format and types`, () => {
			// A gate that lost this half would be faster and would stop being a gate.
			expect(lines(facts).slice(0, 2)).toEqual(["bun run check:format", "bun run check:types"]);
		});

		test(`${what} runs at least one test command, under the one budget`, () => {
			const tests = testLines(facts);
			expect(tests.length).toBeGreaterThan(0);
			for (const line of tests) expect(line).toContain(`--timeout ${CASE_BUDGET_MS}`);
		});
	}
});

describe("what widens the gate", () => {
	test("--all runs the full sweep", () => {
		expect(lines({ all: true, changed: ["lib/workflow/verify.ts"] })).toEqual([
			"bun run check:format",
			"bun run check:types",
			"bun test --timeout 90000",
		]);
		expect(planFor({ all: true, changed: [] }).why).toContain("check:all");
	});

	test("a tree with no branch to narrow against runs the full sweep", () => {
		expect(testLines({ changed: [] })).toEqual(["bun test --timeout 90000"]);
		expect(planFor({ changed: [] }).why).toContain("no branch to narrow against");
	});

	test("a runner file runs the full sweep, naming the file", () => {
		const facts: Facts = { changed: ["docs/tutorials/first-board.md", "test/helpers/preload.ts"] };
		expect(testLines(facts)).toEqual(["bun test --timeout 90000"]);
		expect(planFor(facts).why).toContain("`test/helpers/preload.ts`");
	});

	test("a diff that could not be read runs the full sweep rather than guessing narrow", () => {
		// A shallow clone, a detached HEAD, or a repository whose default branch is elsewhere has no
		// `main`. Narrowing here would skip exactly the suites the change reaches.
		expect(testLines({ changed: undefined })).toEqual(["bun test --timeout 90000"]);
		expect(planFor({ changed: undefined }).why).toContain("could not be read");
		expect(testLines({})).toEqual(["bun test --timeout 90000"]);
	});

	test("the runner is the four files the test invocation is made of", () => {
		expect([...RUNNER_FILES].sort()).toEqual([
			"bun.lock",
			"bunfig.toml",
			"package.json",
			"test/helpers/preload.ts",
			"tsconfig.json",
		]);
		for (const path of RUNNER_FILES) expect(testLines({ changed: [path] })).toEqual(["bun test --timeout 90000"]);
	});
});

describe("the line a reader sees", () => {
	test("names bun rather than the interpreter's path", () => {
		// The gate prints its chain as it runs, so this is what a transcript shows.
		expect(display([process.execPath, "test", "--timeout", "90000"])).toBe("bun test --timeout 90000");
	});

	test("prints a command that is its own binary as it is", () => {
		expect(display(["git", "status"])).toBe("git status");
	});
});
