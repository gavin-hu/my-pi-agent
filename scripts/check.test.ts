/**
 * What the gate must get right, on any machine.
 *
 * `bun run check` is the only thing standing between a change and `main`, so the two ways it can
 * be wrong are both pinned here: a phase that failed must fail the gate, and the phases must
 * actually overlap — a chain that merely reported the same three names would cost exactly the
 * seconds this script exists to save.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CASE_BUDGET_MS } from "../test/helpers/budget.ts";
import { selectExt } from "./test-selection.ts";
import {
	FLAGS,
	type Phase,
	type PhaseResult,
	type Plan,
	parseArgs,
	phasesFor,
	planLines,
	runPhases,
	selectionFor,
	summarize,
} from "./check.ts";

const repo = join(import.meta.dir, "..");

/** A result for one phase, as a runner would report it. */
function result(name: string, code: number, output = "", live = false): PhaseResult {
	return { phase: { name, cmd: [name], live }, code, output };
}

describe("the phases", () => {
	test("runs format, types and the tests, with the run's one case budget", () => {
		const phases = phasesFor({});
		expect(phases.map((phase) => phase.name)).toEqual(["format", "types", "test"]);
		// One file at a time — the gate's only shape — and the budget every case is held to.
		expect((phases[2] as Phase).cmd).toEqual(["bun", "test", "--timeout", String(CASE_BUDGET_MS)]);
	});

	test("streams the long phase and captures the two that say nothing when they pass", () => {
		const phases = phasesFor({});
		expect(phases.map((phase) => phase.live)).toEqual([false, false, true]);
	});
});

describe("the types phase", () => {
	test("compiles incrementally into the ignored state directory, so a second run costs the tests", () => {
		const config = JSON.parse(readFileSync(join(repo, "tsconfig.json"), "utf-8")) as {
			compilerOptions?: { incremental?: boolean; tsBuildInfoFile?: string };
		};
		// The build info is a cache rather than a source: it lives in the directory the report already
		// uses, and CI's fresh checkout never sees it, so the cold result is proved on every job.
		expect(config.compilerOptions?.incremental).toBe(true);
		expect(config.compilerOptions?.tsBuildInfoFile).toBe(".pi/cache/tsconfig.tsbuildinfo");
	});
});

describe("running them", () => {
	test("starts every phase before any of them finishes", async () => {
		const started: string[] = [];
		const pending = runPhases(phasesFor({}), async (phase) => {
			started.push(phase.name);
			return { code: 0, output: "" };
		});
		// All three are in flight: a chain would have one name here and two after the awaits.
		expect(started).toEqual(["format", "types", "test"]);
		expect((await pending).map((entry) => entry.code)).toEqual([0, 0, 0]);
	});
});

describe("the summary", () => {
	test("passes, and says what the gate cost", () => {
		const summary = summarize([result("format", 0), result("types", 0), result("test", 0)], 24.44);
		expect(summary.code).toBe(0);
		expect(summary.message).toBe("check: 3 phases green in 24.4s");
		expect(summary.dump).toBe("");
	});

	test("fails the gate when one phase fails, naming it", () => {
		const summary = summarize([result("format", 0), result("types", 2, "error TS2304"), result("test", 0)], 9);
		expect(summary.code).toBe(1);
		expect(summary.message).toBe("check: types failed in 9.0s");
		// A captured phase's output is the reason it failed, so it is what a reader is shown.
		expect(summary.dump).toBe("error TS2304");
	});

	test("does not repeat a live phase's output, which already reached the terminal", () => {
		const summary = summarize([result("format", 1, "格式"), result("test", 1, "", true)], 3);
		expect(summary.code).toBe(1);
		expect(summary.message).toBe("check: format, test failed in 3.0s");
		expect(summary.dump).toBe("格式");
	});
});

describe("the scope a command line names", () => {
	const all: Plan = {
		scope: "all",
		names: [],
		base: "main",
		watch: false,
		testsOnly: false,
		dryRun: false,
		noLock: false,
	};

	test("no argument is the whole gate, one file at a time, against main", () => {
		expect(parseArgs([])).toEqual(all);
	});

	test("each scope flag replaces the default, and a name is a name", () => {
		const cases: [string[], Partial<Plan>][] = [
			[["--static"], { scope: "static" }],
			[["--root"], { scope: "root" }],
			[["--slow"], { scope: "slow" }],
			[["--changed"], { scope: "changed" }],
			[["--changed", "--base", "develop"], { scope: "changed", base: "develop" }],
			[["--ext", "board", "wechat"], { scope: "ext", names: ["board", "wechat"] }],
			[["--lib", "board"], { scope: "lib", names: ["board"] }],
			[["--tests"], { testsOnly: true }],
			[["--watch"], { watch: true }],
			[["--dry-run"], { dryRun: true }],
			[["--no-lock"], { noLock: true }],
		];
		const wrong = cases
			.map(([argv, expected]) => ({ got: parseArgs(argv), expected: { ...all, ...expected } }))
			.filter(({ got, expected }) => JSON.stringify(got) !== JSON.stringify(expected))
			.map(({ got }) => JSON.stringify(got));
		expect(wrong).toEqual([]);
	});

	test("a second scope is refused by name, not resolved to one of them", () => {
		expect(() => parseArgs(["--ext", "board", "--root"])).toThrow("--ext and --root pick two scopes; give one");
		expect(() => parseArgs(["--base", "develop"])).toThrow("--base names the revision --changed diffs against");
		expect(() => parseArgs(["--static", "--watch"])).toThrow("--watch runs the tests, and --static runs none");
		expect(() => parseArgs(["--ext"])).toThrow("--ext needs a name");
		expect(() => parseArgs(["--lib"])).toThrow("--lib needs a name");
		expect(() => parseArgs(["board"])).toThrow("unexpected argument board; a name follows --ext or --lib");
		expect(() => parseArgs(["--nope"])).toThrow("unknown option --nope");
		// The gate has one shape, so the flag that used to pick between two is gone.
		expect(() => parseArgs(["--serial"])).toThrow("unknown option --serial");
	});

	test("every flag the docs may name is one the parser takes", () => {
		const refused = FLAGS.filter((flag) => {
			const argv =
				flag === "--base"
					? [flag, "main", "--changed"]
					: flag === "--ext" || flag === "--lib"
						? [flag, "board"]
						: [flag];
			try {
				parseArgs(argv);
				return false;
			} catch {
				return true;
			}
		});
		expect(refused).toEqual([]);
	});

	test("a static run names the static half and no tests", () => {
		expect(planLines({ ...all, scope: "static" }, undefined)).toEqual([
			"static > check:format, check:types, beside the tests",
		]);
	});

	test("a run says why each group is in it, then what it will execute", () => {
		const lines = planLines(
			{ ...all, scope: "changed" },
			{ tests: ["a", "b"], reasons: ["package-level > 2 files, always"] },
		);
		expect(lines).toEqual([
			"static > check:format, check:types, beside the tests",
			"  package-level > 2 files, always",
			"tests > 2 files",
		]);
	});

	test("a static plan selects nothing, and a named scope selects its suites", () => {
		expect(selectionFor(repo, { ...all, scope: "static" })).toBeUndefined();
		expect(selectionFor(repo, { ...all, scope: "ext", names: ["board"] })?.tests).toEqual(selectExt(["board"]).tests);
		expect(selectionFor(repo, { ...all, scope: "root" })?.tests).toContain("test/layout.test.ts");
		expect(() => selectionFor(repo, { ...all, scope: "ext", names: ["nope"] })).toThrow("--ext names no such ext");
	});
});

describe("a scoped test phase", () => {
	test("runs the files it was given, after the flags", () => {
		const phases = phasesFor({ tests: ["a.test.ts", "b.test.ts"] });
		const test_ = phases[2] as Phase;
		expect(test_.cmd).toEqual(["bun", "test", "--timeout", String(CASE_BUDGET_MS), "a.test.ts", "b.test.ts"]);
	});

	test("drops the static phases for the `check:tests` entry, and the test phase for `--static`", () => {
		const noStatic = phasesFor({ static: false, tests: ["a.test.ts"] });
		expect(noStatic.map((phase) => phase.name)).toEqual(["test"]);
		const noTests = phasesFor({ tests: null });
		expect(noTests.map((phase) => phase.name)).toEqual(["format", "types"]);
	});

	test("names the report it writes, after the flags and before the files", () => {
		// A second artifact, not a different output: bun still prints the console report, and the
		// file is what a red run's digest reads.
		const phases = phasesFor({ tests: ["a.test.ts"], report: ".pi/cache/r.xml" });
		expect((phases[2] as Phase).cmd).toEqual([
			"bun",
			"test",
			"--timeout",
			String(CASE_BUDGET_MS),
			"--reporter=junit",
			"--reporter-outfile=.pi/cache/r.xml",
			"a.test.ts",
		]);
	});

	test("writes no report for a run that has no test phase, or none it should record", () => {
		const staticOnly = phasesFor({ tests: null, report: ".pi/cache/r.xml" });
		expect(staticOnly.some((phase) => phase.cmd.includes("--reporter=junit"))).toBe(false);
		// Watch rewrites the report on every pass, so the gate leaves it alone: the run it would
		// describe is never the one a reader sees.
		const watched = phasesFor({ tests: ["a.test.ts"], watch: true, report: undefined });
		expect(watched.some((phase) => phase.cmd.includes("--reporter=junit"))).toBe(false);
	});

	test("watch implies isolate, and the slow scope carries its gate", () => {
		const watched = phasesFor({ watch: true, static: false, tests: ["a.test.ts"] });
		expect((watched[0] as Phase).cmd).toEqual(["bun", "test", "--watch", "--isolate", "a.test.ts"]);
		const slow = phasesFor({ tests: ["s.test.ts"], env: { PI_SLOW_TESTS: "1" } });
		expect((slow[2] as Phase).env).toEqual({ PI_SLOW_TESTS: "1" });
	});
});

describe("a run with nothing to do", () => {
	test("refuses --tests --static rather than reporting zero phases green", () => {
		expect(() => parseArgs(["--tests", "--static"])).toThrow(
			"--static is the check's static half; bun run check:tests has none",
		);
	});
});

describe("a selection that carries the gate", () => {
	const selection = { tests: ["a.test.ts"], reasons: ["ext:worktree > 4 suites"] };

	test("says how many of its files skip without the gate, and what runs them", () => {
		const lines = planLines(
			{
				scope: "all",
				names: [],
				base: "main",
				watch: false,
				testsOnly: true,
				dryRun: false,
				noLock: false,
			},
			selection,
			2,
		);
		expect(lines.at(-1)).toBe(
			"  2 of them are gated suites: their cases skip without PI_SLOW_TESTS=1 — `bun run check:tests --slow` runs those",
		);
	});

	test("says nothing when none of them is gated, and names one as one", () => {
		const plan = {
			scope: "all" as const,
			names: [],
			base: "main",
			watch: false,
			testsOnly: true,
			dryRun: false,
			noLock: false,
		};
		expect(planLines(plan, selection).at(-1)).toBe("tests > 1 files");
		expect(planLines(plan, selection, 1).at(-1)).toContain("1 of them is a gated suite");
		// Watch is the one shape left that the line still has to name.
		expect(planLines({ ...plan, watch: true }, selection).at(-1)).toBe("tests > 1 files (--watch)");
	});
});
