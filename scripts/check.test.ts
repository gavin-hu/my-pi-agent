/**
 * What the gate must get right, on any machine.
 *
 * `bun run check` is the only thing standing between a change and `main`, so the two ways it can
 * be wrong are both pinned here: a phase that failed must fail the gate, and the phases must
 * actually overlap — a chain that merely reported the same three names would cost exactly the
 * seconds this script exists to save.
 */

import { describe, expect, test } from "bun:test";
import {
	PHASE_TIMEOUT_MS,
	phasesFor,
	runPhases,
	summarize,
	workersFor,
	type Phase,
	type PhaseResult,
} from "./check.ts";

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
