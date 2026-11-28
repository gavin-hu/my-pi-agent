/**
 * The gate's plan: which chain a `check` runs, and why it is that one.
 *
 * The subject here is a decision rather than a process — `planFor` is pure, so what the gate would
 * run is a case and not a comment. What the cases hold, in order of what breaks quietly:
 *
 * - **the ordinary plan is exactly four commands** — format, types, `--changed=main`, and the `test/`
 *   sweeps, the last two over the browser tier. Without this one a later edit can drop a step and
 *   every other case still passes, which is the failure #745 exists to prevent: a `check` that has
 *   quietly become the fast half.
 * - **format and types are in every plan**, asked for or widened anyway, because they are what a
 *   landing owes whatever the tests cost.
 * - **the budget rides every test command**, so a narrower plan cannot lose the timeout the one
 *   `CASE_BUDGET_MS` states.
 * - **each widening has its own case**: `--all`, no branch diff, a runner file, and a `git` read that
 *   failed. The last is the one where a wrong answer silently skips the suites a change selects.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { CASE_BUDGET_MS } from "../test/helpers/budget.ts";
import { BROWSER_SUITES, SMOKE_SUITES } from "../test/helpers/browser-suites.ts";
import { display, type Facts, hintFor, PARALLEL_HINT_MS, parseParallel, planFor, RUNNER_FILES } from "./check.ts";

/** A branch that changed one leaf module. */
const LEAF: Facts = { changed: ["lib/workflow/verify.ts"] };

/** A suite no other suite imports, so the case that runs the runner recurses into nothing. */
const LEAF_SUITE = "lib/json.test.ts";

/** The commands as `display` spells them, which is what a reader sees and what a case can read. */
function lines(facts: Facts): string[] {
	return planFor(facts).commands.map((command) => display(command));
}

/** Every `bun test` line in a plan, so the budget can be asked of all of them. */
function testLines(facts: Facts): string[] {
	return lines(facts).filter((line) => line.startsWith("bun test"));
}

/** The browser suites a plan ignores, by the exact paths its tier flags name. */
function ignoredSuites(facts: Facts): string[] {
	// The same tier rides both test commands, so the list here is the set, not the occurrences.
	return [
		...new Set(
			planFor(facts)
				.commands.flatMap((command) => command)
				.filter((argument) => argument.startsWith("--path-ignore-patterns="))
				.map((argument) => argument.slice("--path-ignore-patterns=".length)),
		),
	];
}

describe("the browser tier", () => {
	test("ignores exactly the layer's suites outside the smoke four", () => {
		const ignored = ignoredSuites(LEAF);
		expect(ignored).toHaveLength(BROWSER_SUITES.length - SMOKE_SUITES.length);
		for (const suite of ignored) expect(BROWSER_SUITES).toContain(suite);
		// A smoke suite in the ignore list would be a suite the gate claims to run and does not.
		for (const suite of SMOKE_SUITES) expect(ignored).not.toContain(suite);
	});

	test("rides both test commands of the ordinary plan, and no other", () => {
		const plan = planFor(LEAF);
		const carries = (command: readonly string[]) =>
			command.filter((argument) => argument.startsWith("--path-ignore-patterns=")).length;
		expect(carries(plan.commands[2] ?? [])).toBe(BROWSER_SUITES.length - SMOKE_SUITES.length);
		expect(carries(plan.commands[3] ?? [])).toBe(BROWSER_SUITES.length - SMOKE_SUITES.length);
	});

	test("is absent from every widened plan, so CI runs the whole layer", () => {
		const wider: Facts[] = [
			{ all: true, changed: ["lib/workflow/verify.ts"] },
			{ changed: [] },
			{ changed: undefined },
			{},
		];
		for (const facts of wider) expect(ignoredSuites(facts)).toEqual([]);
	});

	test("names the layer's declaration as the runner's, since it decides what the gate runs", () => {
		expect(RUNNER_FILES).toContain("test/helpers/browser-suites.ts");
		expect(testLines({ changed: ["test/helpers/browser-suites.ts"] })).toEqual(["bun test --timeout 90000"]);
	});
});

describe("the ordinary gate", () => {
	test("is format, types, this branch's suites, and the sweeps, the last two over the tier", () => {
		const plan = planFor(LEAF);
		expect(plan.commands).toHaveLength(4);
		expect(display(plan.commands[0] ?? [])).toBe("bun run check:format");
		expect(display(plan.commands[1] ?? [])).toBe("bun run check:types");
		// The tier is asserted by count and membership above rather than pasted here: a 37-flag
		// literal in a case is a diff nobody reads and a copy that drifts with the layer.
		expect(display(plan.commands[2] ?? []).startsWith("bun test --timeout 90000 --changed=main ")).toBe(true);
		expect(display(plan.commands[3] ?? []).startsWith("bun test --timeout 90000 test/ ")).toBe(true);
	});

	test("says nothing about widening, because it did not widen", () => {
		expect(planFor(LEAF).why).toBeUndefined();
	});

	test("the sweeps, which no import graph can select", () => {
		// The tree contracts read files rather than import them, so `--changed` cannot see them. Dropping
		// this command would leave a docs change gated by nothing at all.
		expect(testLines(LEAF).filter((line) => line.includes(" test/ "))).toHaveLength(1);
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

	test("the runner is the files the test invocation is made of", () => {
		expect([...RUNNER_FILES].sort()).toEqual([
			"bun.lock",
			"bunfig.toml",
			"package.json",
			"test/helpers/browser-suites.ts",
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

	test("prints the browser tier as one token, while the argv keeps every flag", () => {
		// The line is a transcript, not a command: it names what the gate ignores once, and the
		// argv's exact paths are what runs. `--all` carries no tier, so its line is the plain sweep.
		const plan = planFor(LEAF);
		const changed = plan.commands[2] ?? [];
		const flags = changed.filter((argument) => argument.startsWith("--path-ignore-patterns=")).length;
		const line = display(changed);
		expect(flags).toBeGreaterThan(0);
		expect(line.endsWith(`--path-ignore-patterns=<${flags} browser suites>`)).toBe(true);
		expect(line.length).toBeLessThan(120);
		expect(line).not.toContain("extensions/");
		expect(display(plan.commands[3] ?? [])).toContain(`<${flags} browser suites>`);
		expect(display(planFor({ all: true }).commands[2] ?? [])).toBe("bun test --timeout 90000");
	});

	test("prints a command that is its own binary as it is", () => {
		expect(display(["git", "status"])).toBe("git status");
	});
});

describe("a worker count a caller asks for", () => {
	test("rides both test commands, after the budget, and nothing else", () => {
		const plan = planFor({ ...LEAF, parallel: 4 });
		expect(display(plan.commands[0] ?? [])).toBe("bun run check:format");
		expect(display(plan.commands[1] ?? [])).toBe("bun run check:types");
		expect(display(plan.commands[2] ?? []).startsWith("bun test --timeout 90000 --parallel=4 --changed=main ")).toBe(true);
		expect(display(plan.commands[3] ?? []).startsWith("bun test --timeout 90000 --parallel=4 test/ ")).toBe(true);
	});

	test("is carried by a widened plan too, because only a human asked for it", () => {
		expect(display(planFor({ all: true, parallel: 4 }).commands[2] ?? [])).toBe("bun test --timeout 90000 --parallel=4");
	});

	test("is absent from every plan nobody asked, which is the default this card keeps", () => {
		const wider: Facts[] = [
			LEAF,
			{ all: true, changed: ["lib/workflow/verify.ts"] },
			{ changed: [] },
			{ changed: undefined },
			{},
		];
		for (const facts of wider) expect(lines(facts).some((line) => line.includes("--parallel"))).toBe(false);
	});
});

describe("the flag as the wrapper reads it", () => {
	test("takes a positive count", () => {
		expect(parseParallel(["--all"])).toEqual({});
		expect(parseParallel(["--parallel=4"])).toEqual({ parallel: 4 });
		expect(parseParallel(["--all", "--parallel=2"])).toEqual({ parallel: 2 });
	});

	test("refuses a bare flag or a count that is not a positive number, rather than dropping it", () => {
		// A silent drop is a gate that ignores what it was asked; filling in a number is a gate guessing
		// the cores of a machine it has not met.
		for (const argv of [["--parallel"], ["--parallel=0"], ["--parallel=four"], ["--parallel="]]) {
			expect(parseParallel(argv).refusal).toContain("--parallel=4");
			expect(parseParallel(argv).parallel).toBeUndefined();
		}
	});
});

describe("the advice a slow step gets", () => {
	const step = (facts: Facts = LEAF): readonly string[] => planFor(facts).commands[2] ?? [];

	test("names the command that would have been faster, and the seconds it took", () => {
		const hint = hintFor({ command: step(), ms: 129_400 });
		expect(hint).toContain("129s");
		expect(hint).toContain("bun run check --parallel=4");
	});

	test("says nothing below the bar, when the run already asked, or for a step that is not a test run", () => {
		expect(hintFor({ command: step(), ms: PARALLEL_HINT_MS - 1 })).toBeUndefined();
		expect(hintFor({ command: step({ ...LEAF, parallel: 4 }), ms: PARALLEL_HINT_MS * 10 })).toBeUndefined();
		expect(hintFor({ command: planFor(LEAF).commands[0] ?? [], ms: PARALLEL_HINT_MS * 10 })).toBeUndefined();
	});
});

describe("the runner's own answer", () => {
	test("accepts the flag this gate forwards, and runs the suite it names", () => {
		// The one case here that starts a second process, and the reason is the card: a flag the runner
		// ignored would make every `verify` in the repository a no-op, and one it rejected would break
		// them all at once. Neither is visible from a green run, so the flag is spent here — once, over a
		// leaf suite. `PI_NO_LOCK` because this suite already holds the machine's lock.
		const run = spawnSync(process.execPath, ["test", "--timeout", String(CASE_BUDGET_MS), "--parallel=4", LEAF_SUITE], {
			cwd: join(import.meta.dir, ".."),
			env: { ...process.env, PI_NO_LOCK: "1" },
			encoding: "utf8",
		});
		expect(run.status).toBe(0);
		// Honoured, not merely tolerated: the banner names the worker count the flag asked for, which is
		// the half a green run cannot show — a flag that parsed and was then ignored looks identical.
		expect(run.stdout).toContain("PARALLEL");
	});
});
