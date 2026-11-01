/**
 * The gate: `bun run check` and `bun run check:serial`.
 *
 * Three phases make up a check — format, typecheck, test — and only the last one uses more than
 * one core. Run in a chain, the two single-threaded phases hold every core for ~8 s before the
 * tests start, so they run beside the test phase instead: the gate costs what its longest phase
 * costs. The worker count comes from the machine rather than a constant, because a 4-core runner
 * given eight workers starves the suites that spawn git and a browser.
 *
 *   check.ts            the parallel gate, for a developer's machine
 *   check.ts --serial   the same gate with the test phase serial, which is what macOS CI runs
 */

import { availableParallelism } from "node:os";

/** One command the gate runs. */
export interface Phase {
	/** What the failure summary calls it, in the order the summary reads. */
	name: string;
	cmd: string[];
	/**
	 * Stream this phase's output while it runs, or capture it and print it only on failure.
	 *
	 * The test phase is the long one and its progress is the only thing on screen for most of the
	 * gate, so it streams; the other two say nothing when they pass, and their output is what a
	 * reader wants only when they do not.
	 */
	live: boolean;
}

/** What one phase did. */
export interface PhaseResult {
	phase: Phase;
	code: number;
	/** Captured output, empty for a `live` phase, whose output already went to the terminal. */
	output: string;
}

/** The test budget the scripts state, reaching hooks as well as cases. */
export const PHASE_TIMEOUT_MS = 30_000;

/** The most workers one machine is given, however many cores it reports. */
const MAX_WORKERS = 4;

/**
 * How many test files run at once.
 *
 * The cores the machine has, capped at four — the number `test/README.md` already documents, kept
 * because it held: at seven workers on a loaded box two wall-clock budgets broke (a 100 ms timer
 * measured at 263 ms, and `job`'s shell-exit budget passed 25 s), and a gate that fails when the
 * machine is busy is worse than a slower one. Floored at two so a small runner still parallelizes;
 * a two-core box is not given four workers to starve itself with.
 */
export function workersFor(cpus: number): number {
	return Math.max(2, Math.min(cpus, MAX_WORKERS));
}

/** The three phases, in the order a summary reads them. */
export function phasesFor(options: { serial: boolean; workers: number }): Phase[] {
	const test = options.serial
		? ["bun", "test", "--timeout", String(PHASE_TIMEOUT_MS)]
		: ["bun", "test", `--parallel=${options.workers}`, "--timeout", String(PHASE_TIMEOUT_MS)];
	return [
		{ name: "format", cmd: ["bun", "run", "format:check"], live: false },
		{ name: "typecheck", cmd: ["bun", "run", "typecheck"], live: false },
		{ name: "test", cmd: test, live: true },
	];
}

/** How one phase is run; injected so the gate's own tests need no subprocess. */
export type Runner = (phase: Phase) => Promise<{ code: number; output: string }>;

/** Run every phase at once, and answer with what each did. */
export async function runPhases(phases: readonly Phase[], run: Runner): Promise<PhaseResult[]> {
	return Promise.all(phases.map(async (phase) => ({ phase, ...(await run(phase)) })));
}

/** The gate's exit code and its one summary line, from what the phases did. */
export function summarize(
	results: readonly PhaseResult[],
	seconds: number,
	workers: number,
	serial: boolean,
): {
	code: number;
	message: string;
	dump: string;
} {
	const failed = results.filter((result) => result.code !== 0);
	const elapsed = seconds.toFixed(1);
	if (failed.length === 0) {
		const how = serial ? "serial" : `${workers} workers`;
		return {
			code: 0,
			message: `check: ${results.length} phases green in ${elapsed}s (test ${how})`,
			dump: "",
		};
	}
	// A live phase already showed its output; a captured one is what a reader needs to see now.
	const dump = failed
		.filter((result) => !result.phase.live && result.output !== "")
		.map((result) => result.output.trimEnd())
		.join("\n");
	return {
		code: 1,
		message: `check: ${failed.map((result) => result.phase.name).join(", ")} failed in ${elapsed}s`,
		dump,
	};
}

/** Run one command, streaming it or capturing it as the phase asks. */
async function spawnPhase(phase: Phase): Promise<{ code: number; output: string }> {
	const proc = Bun.spawn(phase.cmd, {
		stdout: phase.live ? "inherit" : "pipe",
		stderr: phase.live ? "inherit" : "pipe",
	});
	if (phase.live) return { code: await proc.exited, output: "" };
	const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	const code = await proc.exited;
	return { code, output: `${out}${err}` };
}

/** The gate: every phase at once, its failures named, its exit code the one that matters. */
async function main(argv: readonly string[]): Promise<number> {
	const serial = argv.includes("--serial");
	const workers = workersFor(availableParallelism());
	const phases = phasesFor({ serial, workers });
	const started = performance.now();
	const results = await runPhases(phases, spawnPhase);
	const summary = summarize(results, (performance.now() - started) / 1000, workers, serial);
	if (summary.dump !== "") process.stderr.write(`${summary.dump}\n`);
	if (summary.code === 0) console.log(summary.message);
	else console.error(summary.message);
	return summary.code;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
