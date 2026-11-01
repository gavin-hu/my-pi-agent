/**
 * What the gate must get right, on any machine.
 *
 * `bun run check` is the only thing standing between a change and `main`, so the two ways it can
 * be wrong are both pinned here: a phase that failed must fail the gate, and the phases must
 * actually overlap — a chain that merely reported the same three names would cost exactly the
 * seconds this script exists to save.
 */

import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { selectExt } from "./test-selection.ts";
import {
	FLAGS,
	PHASE_TIMEOUT_MS,
	type Phase,
	type PhaseResult,
	type Plan,
	parseArgs,
	phasesFor,
	planLines,
	runPhases,
	selectionFor,
	summarize,
	workersFor,
} from "./check.ts";

const repo = join(import.meta.dir, "..");

/** A result for one phase, as a runner would report it. */
function result(name: string, code: number, output = "", live = false): PhaseResult {
	return { phase: { name, cmd: [name], live }, code, output };
}

describe("the worker count", () => {
	test("uses the cores, floored at two and capped at the number the docs name", () => {
		expect(workersFor(8)).toBe(4);
		expect(workersFor(4)).toBe(4);
		// A two-core runner still parallelizes rather than running one file at a time.
		expect(workersFor(2)).toBe(2);
		expect(workersFor(1)).toBe(2);
	});

	test("does not chase a larger machine, because a busy box already broke seven", () => {
		expect(workersFor(32)).toBe(4);
	});
});

describe("the phases", () => {
	test("runs format, typecheck and the tests, with the budget the scripts state", () => {
		const phases = phasesFor({ serial: false, workers: 4 });
		expect(phases.map((phase) => phase.name)).toEqual(["format", "typecheck", "test"]);
		const test_ = phases[2] as Phase;
		expect(test_.cmd).toContain("--parallel=4");
		expect(test_.cmd).toContain(String(PHASE_TIMEOUT_MS));
	});

	test("drops the worker flag on the serial path macOS CI runs", () => {
		const phases = phasesFor({ serial: true, workers: 7 });
		const test_ = phases[2] as Phase;
		expect(test_.cmd.some((arg) => arg.startsWith("--parallel="))).toBe(false);
		expect(test_.cmd).toContain("--timeout");
	});

	test("streams the long phase and captures the two that say nothing when they pass", () => {
		const phases = phasesFor({ serial: false, workers: 7 });
		expect(phases.map((phase) => phase.live)).toEqual([false, false, true]);
	});
});

describe("running them", () => {
	test("starts every phase before any of them finishes", async () => {
		const started: string[] = [];
		const pending = runPhases(phasesFor({ serial: false, workers: 7 }), async (phase) => {
			started.push(phase.name);
			return { code: 0, output: "" };
		});
		// All three are in flight: a chain would have one name here and two after the awaits.
		expect(started).toEqual(["format", "typecheck", "test"]);
		expect((await pending).map((entry) => entry.code)).toEqual([0, 0, 0]);
	});
});

describe("the summary", () => {
	test("passes, and says what the gate cost", () => {
		const summary = summarize([result("format", 0), result("typecheck", 0), result("test", 0)], 24.44, 7, false);
		expect(summary.code).toBe(0);
		expect(summary.message).toBe("check: 3 phases green in 24.4s (test 7 workers)");
		expect(summary.dump).toBe("");
	});

	test("fails the gate when one phase fails, naming it", () => {
		const summary = summarize(
			[result("format", 0), result("typecheck", 2, "error TS2304"), result("test", 0)],
			9,
			7,
			false,
		);
		expect(summary.code).toBe(1);
		expect(summary.message).toBe("check: typecheck failed in 9.0s");
		// A captured phase's output is the reason it failed, so it is what a reader is shown.
		expect(summary.dump).toBe("error TS2304");
	});

	test("does not repeat a live phase's output, which already reached the terminal", () => {
		const summary = summarize([result("format", 1, "格式"), result("test", 1, "", true)], 3, 7, true);
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
		serial: false,
		watch: false,
		testsOnly: false,
		dryRun: false,
	};

	test("no argument is the whole gate, in parallel, against main", () => {
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
			[["--serial"], { serial: true }],
			[["--watch"], { watch: true }],
			[["--dry-run"], { dryRun: true }],
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
			"static > format:check, typecheck, beside the tests",
		]);
	});

	test("a run says why each group is in it, then what it will execute", () => {
		const lines = planLines(
			{ ...all, scope: "changed" },
			{ tests: ["a", "b"], reasons: ["package-level > 2 files, always"] },
		);
		expect(lines).toEqual([
			"static > format:check, typecheck, beside the tests",
			"  package-level > 2 files, always",
			"tests > 2 files (parallel)",
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
		const phases = phasesFor({ serial: false, workers: 3, tests: ["a.test.ts", "b.test.ts"] });
		const test_ = phases[2] as Phase;
		expect(test_.cmd).toEqual(["bun", "test", "--parallel=3", "--timeout", "30000", "a.test.ts", "b.test.ts"]);
	});

	test("drops the static phases for the `test` entry, and the test phase for `--static`", () => {
		const noStatic = phasesFor({ serial: false, workers: 3, static: false, tests: ["a.test.ts"] });
		expect(noStatic.map((phase) => phase.name)).toEqual(["test"]);
		const noTests = phasesFor({ serial: false, workers: 3, tests: null });
		expect(noTests.map((phase) => phase.name)).toEqual(["format", "typecheck"]);
	});

	test("watch implies isolate, and the slow scope carries its gate", () => {
		const watched = phasesFor({ serial: false, workers: 3, watch: true, static: false, tests: ["a.test.ts"] });
		expect((watched[0] as Phase).cmd).toEqual(["bun", "test", "--watch", "--isolate", "a.test.ts"]);
		const slow = phasesFor({ serial: false, workers: 3, tests: ["s.test.ts"], env: { PI_SLOW_TESTS: "1" } });
		expect((slow[2] as Phase).env).toEqual({ PI_SLOW_TESTS: "1" });
	});
});
