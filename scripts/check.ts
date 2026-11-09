/**
 * The gate: `bun run check` and `bun run check:tests`, each of them with a scope.
 *
 * Three phases make up a check — format, types, test — and only the last one uses more than
 * one core. Run in a chain, the two single-threaded phases hold every core for ~8 s before the
 * tests start, so they run beside the test phase instead: the gate costs what its longest phase
 * costs. The worker count comes from the machine rather than a constant, because a 4-core runner
 * given eight workers starves the suites that spawn git and a browser.
 *
 * Which tests the last phase runs is a flag rather than another script name — `test-selection.ts`
 * answers that half — so the surface is two entries and one vocabulary:
 *
 *   check.ts                       static + every test, the gate a landing needs
 *   check.ts --tests               the tests alone, which is `bun run check:tests`
 *   check.ts --static              the static half alone
 *   check.ts --serial              one file at a time, which is what CI's Linux and macOS jobs run
 *   check.ts --watch               the tests in watch mode
 *   check.ts --ext board wechat    one or more extensions' declared suites
 *   check.ts --lib board           one `lib/` area's suites
 *   check.ts --root                the package-level tests
 *   check.ts --slow                the gated git suites, with the gate on
 *   check.ts --changed [--base r]  the tests this change can reach
 *   check.ts --dry-run             print the selection, run nothing
 */

import { mkdirSync, rmSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { CASE_BUDGET_MS } from "../test/helpers/budget.ts";
import { runSlowSuites } from "../test/helpers/slow-suite.ts";
import { giveUpLine, takeOverLine, waitingLine, withGateLock } from "./check-lock.ts";
import { runCli } from "./cli.ts";
import { reportDigest, reportPath } from "./junit.ts";
import {
	gatedAmong,
	type Selection,
	reachIndex,
	selectAll,
	selectChanged,
	selectExt,
	selectLib,
	selectRoot,
	selectSlow,
	tree,
} from "./test-selection.ts";

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
	/** Extra environment for this phase, such as the gate the slow suites read. */
	env?: Record<string, string>;
}

/** What one phase did. */
export interface PhaseResult {
	phase: Phase;
	code: number;
	/** Captured output, empty for a `live` phase, whose output already went to the terminal. */
	output: string;
}

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

/** What one test phase covers: a scope's files, the whole suite, or no test phase at all. */
export interface PhaseOptions {
	serial: boolean;
	workers: number;
	/** Format and types as well; `false` is what `bun run check:tests` runs. */
	static?: boolean;
	/** The files to run: absent is the whole suite, `null` is no test phase. */
	tests?: readonly string[] | null;
	/** `bun test --watch`, which implies `--isolate`. */
	watch?: boolean;
	/** Environment the test phase reads, such as `PI_SLOW_TESTS=1`. */
	env?: Record<string, string>;
	/**
	 * Where the test phase writes bun's JUnit report, when it should write one.
	 *
	 * A second artifact, not a different output: bun prints the console report either way, so
	 * this is the machine-readable half a red run names its failures from.
	 */
	report?: string;
}

/** The three phases, in the order a summary reads them. */
export function phasesFor(options: PhaseOptions): Phase[] {
	const phases: Phase[] = [];
	if (options.static !== false) {
		phases.push(
			{ name: "format", cmd: ["bun", "run", "check:format"], live: false },
			{ name: "types", cmd: ["bun", "run", "check:types"], live: false },
		);
	}
	if (options.tests === null) return phases;
	const flags = options.watch
		? ["--watch", "--isolate"]
		: options.serial
			? ["--timeout", String(CASE_BUDGET_MS)]
			: [`--parallel=${options.workers}`, "--timeout", String(CASE_BUDGET_MS)];
	const report = options.report === undefined ? [] : ["--reporter=junit", `--reporter-outfile=${options.report}`];
	phases.push({
		name: "test",
		cmd: ["bun", "test", ...flags, ...report, ...(options.tests ?? [])],
		live: true,
		env: options.env,
	});
	return phases;
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
		const phases = `${results.length} phase${results.length === 1 ? "" : "s"}`;
		return {
			code: 0,
			message: `check: ${phases} green in ${elapsed}s (test ${how})`,
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
		...(phase.env ? { env: { ...process.env, ...phase.env } } : {}),
	});
	if (phase.live) return { code: await proc.exited, output: "" };
	const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	const code = await proc.exited;
	return { code, output: `${out}${err}` };
}

/** What a run covers, one scope at a time. */
export type Scope = "all" | "static" | "changed" | "ext" | "lib" | "root" | "slow";

/** A parsed command line. */
export interface Plan {
	scope: Scope;
	/** Extension or `lib/` area names, for `ext` and `lib`. */
	names: string[];
	/** The git revision `--changed` diffs against. */
	base: string;
	/** One file at a time, which is what CI's Linux and macOS jobs run. */
	serial: boolean;
	/** `bun test --watch`. */
	watch: boolean;
	/** The `check:tests` entry: skip the static phases. */
	testsOnly: boolean;
	/** Print the plan and run nothing. */
	dryRun: boolean;
	/** Run beside another check on this machine instead of waiting for it. */
	noLock: boolean;
}

/** The flags this command accepts, which is what a doc may name. */
export const FLAGS = [
	"--changed",
	"--base",
	"--ext",
	"--lib",
	"--root",
	"--slow",
	"--static",
	"--serial",
	"--no-lock",
	"--watch",
	"--tests",
	"--dry-run",
] as const;

const USAGE = `usage: bun run check [--static | --changed [--base <ref>] | --ext <name...> | --lib <area...> | --root | --slow]
                    [--serial | --watch] [--no-lock] [--dry-run]
       bun run check:tests  the same scopes without the static half`;

const SCOPE_FLAGS: Record<string, Scope> = {
	"--static": "static",
	"--changed": "changed",
	"--ext": "ext",
	"--lib": "lib",
	"--root": "root",
	"--slow": "slow",
};

/**
 * Parse the command line. A scope flag is exclusive, `--base` belongs to
 * `--changed`, and a positional argument is a name only where one is expected —
 * each of those refuses rather than guessing what was meant.
 */
export function parseArgs(argv: string[]): Plan {
	const plan: Plan = {
		scope: "all",
		names: [],
		base: "main",
		serial: false,
		watch: false,
		testsOnly: false,
		dryRun: false,
		noLock: false,
	};
	let scopeFlag: string | undefined;
	let gaveBase = false;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		const value = (): string => {
			const next = argv[++index];
			if (next === undefined) throw new Error(`${arg} needs a value`);
			return next;
		};
		const scope = SCOPE_FLAGS[arg];
		if (scope !== undefined) {
			if (scopeFlag !== undefined) throw new Error(`${scopeFlag} and ${arg} pick two scopes; give one`);
			scopeFlag = arg;
			plan.scope = scope;
		} else if (arg === "--base") {
			plan.base = value();
			gaveBase = true;
		} else if (arg === "--serial") plan.serial = true;
		else if (arg === "--no-lock") plan.noLock = true;
		else if (arg === "--watch") plan.watch = true;
		else if (arg === "--tests") plan.testsOnly = true;
		else if (arg === "--dry-run") plan.dryRun = true;
		else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
		else plan.names.push(arg);
	}
	if (gaveBase && plan.scope !== "changed") throw new Error("--base names the revision --changed diffs against");
	if (plan.watch && plan.scope === "static") throw new Error("--watch runs the tests, and --static runs none");
	if (plan.testsOnly && plan.scope === "static")
		throw new Error("--static is the check's static half; bun run check:tests has none");
	if ((plan.scope === "ext" || plan.scope === "lib") && plan.names.length === 0) {
		throw new Error(`--${plan.scope} needs a name`);
	}
	if (plan.names.length > 0 && plan.scope !== "ext" && plan.scope !== "lib") {
		throw new Error(`unexpected argument ${plan.names[0]}; a name follows --ext or --lib`);
	}
	return plan;
}

/**
 * The whole plan, in the order it runs, so a run can be read before it starts.
 *
 * `gated` is how many of the selected files are gated suites: their cases skip
 * unless the run turns the gate on, which is the one thing a scoped run would
 * otherwise read as full coverage.
 */
export function planLines(plan: Plan, chosen: Selection | undefined, gated = 0): string[] {
	const lines: string[] = [];
	if (!plan.testsOnly && !plan.watch) lines.push("static > check:format, check:types, beside the tests");
	if (chosen === undefined) return lines;
	for (const reason of chosen.reasons) lines.push(`  ${reason}`);
	const scope = plan.watch ? "--watch" : plan.serial ? "serial" : "parallel";
	lines.push(`tests > ${chosen.tests.length} files (${scope})`);
	if (gated > 0) {
		const suites = `${gated} of them ${gated === 1 ? "is a gated suite" : "are gated suites"}`;
		lines.push(`  ${suites}: their cases skip without PI_SLOW_TESTS=1 — \`bun run check:tests --slow\` runs those`);
	}
	return lines;
}

/** The selection the plan names, or `undefined` for a run that has no tests. */
export function selectionFor(root: string, plan: Plan): Selection | undefined {
	if (plan.scope === "static") return undefined;
	if (plan.scope === "ext") return selectExt(plan.names);
	if (plan.scope === "lib") return selectLib(plan.names);
	if (plan.scope === "root") return selectRoot(tree(root));
	if (plan.scope === "slow") return selectSlow(root);
	if (plan.scope === "changed") return selectChanged(tree(root), changedPaths(root, plan.base), reachIndex(root));
	return selectAll(tree(root));
}

/** Every path that differs from `base`: on the branch, in the index, or in the working tree. */
export function changedPaths(root: string, base: string): string[] {
	const paths = new Set<string>();
	const calls = [
		["diff", "--name-only", "--relative", `${base}...HEAD`],
		["diff", "--name-only", "--relative"],
		["diff", "--name-only", "--relative", "--cached"],
		["ls-files", "--others", "--exclude-standard"],
	];
	for (const args of calls) {
		const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
		if (result.exitCode !== 0) {
			const message = result.stderr.toString().trim() || `git ${args.join(" ")} failed`;
			throw new Error(`${message}\n--changed diffs against \`${base}\`; name another revision with --base`);
		}
		for (const path of result.stdout.toString().split("\n")) if (path.trim()) paths.add(path.trim());
	}
	return [...paths].sort();
}

/** The gate: every phase at once, its failures named, its exit code the one that matters. */
async function main(): Promise<void> {
	const root = join(import.meta.dir, "..");
	const plan = parseArgs(process.argv.slice(2));
	const selected = performance.now();
	const chosen = selectionFor(root, plan);
	const walked = Math.round(performance.now() - selected);
	// `--slow` turns the gate on below, so its own selection needs no warning.
	const gated = chosen && plan.scope !== "slow" && !runSlowSuites ? gatedAmong(root, chosen.tests).length : 0;
	for (const line of planLines(plan, chosen, gated)) console.log(line);
	// The walk is the one cost a narrowed run pays before its first test: say it.
	if (plan.scope === "changed") console.log(`  selection took ${walked}ms`);
	if (plan.dryRun) return;
	const workers = workersFor(availableParallelism());
	const report = reportPath(root);
	if (!plan.watch) {
		// The report is this attempt's or absent: a file left by an older run would be read as
		// this one's, and bun writes no directory for the outfile.
		mkdirSync(dirname(report), { recursive: true });
		rmSync(report, { force: true });
	}
	const phases = phasesFor({
		serial: plan.serial,
		workers,
		static: !plan.testsOnly && !plan.watch,
		tests: chosen === undefined ? null : chosen.tests,
		watch: plan.watch,
		...(plan.scope === "slow" ? { env: { PI_SLOW_TESTS: "1" } } : {}),
		...(plan.watch ? {} : { report }),
	});
	const started = performance.now();
	// One gate per machine: two checkouts checking at once starve each other's spawns, and the
	// suites that wait on a child are the ones that break. `--watch` and `--dry-run` never take it.
	const results = await withGateLock(
		{
			skip: plan.noLock || plan.watch,
			path: root,
			onWait: (holder) => console.log(waitingLine(holder)),
			onTakeOver: (stale) => console.log(takeOverLine(stale)),
			onGiveUp: (holder, waitedMs) => console.log(giveUpLine(holder, waitedMs)),
		},
		() => runPhases(phases, spawnPhase),
	);
	const summary = summarize(results, (performance.now() - started) / 1000, workers, plan.serial);
	// A test failure names its cases; the other phases dump what they printed, and both can be
	// true of one run.
	const tested = results.some((result) => result.phase.name === "test" && result.code !== 0);
	if (summary.dump !== "") process.stderr.write(`${summary.dump}\n`);
	if (tested) process.stderr.write(`${reportDigest(report)}\n`);
	if (summary.code === 0) console.log(summary.message);
	else console.error(summary.message);
	process.exitCode = summary.code;
}

if (import.meta.main) {
	if (process.argv.includes("-h") || process.argv.includes("--help")) console.log(USAGE);
	else runCli(USAGE, main);
}
