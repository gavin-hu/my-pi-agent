#!/usr/bin/env bun
/**
 * `bun run check`: the landing gate, behind the lock that makes two panes queue.
 *
 * Two names run this file. `check` is what a landing pays: format, types, then the tests the change
 * actually reaches — `--changed=main` plus the `test/` sweeps, which read the tree rather than import
 * it and so cannot be selected by an import graph. `check:all` is the full sweep, which is CI's job,
 * `publish.yml`'s, and a release's.
 *
 * Every plan starts with format and types: they are what a landing owes whatever the tests cost, and
 * `scripts/check.test.ts` fails if a later edit drops them.
 *
 * The chain is printed as it runs, so a narrow gate says which half it is narrowing to rather than
 * leaving a reader to trust that the missing one was not owed.
 *
 * The budget rides the command a person types: `bunfig.toml` has no key for `--timeout` and
 * `setDefaultTimeout` does not reach a hook, so the number is written here and
 * `test/wait-budget.test.ts` holds it to `CASE_BUDGET_MS`.
 */

import { spawnSync } from "node:child_process";
import { acquireGate } from "./gate-lock.ts";
import { BROWSER_SUITES, SMOKE_SUITES } from "../test/helpers/browser-suites.ts";

/** One command in the chain: what to run, as `spawnSync` takes it. */
export type Command = readonly string[];

/** `--timeout 90000`, which is `CASE_BUDGET_MS`. See the note above: it cannot live in a config file. */
const BUDGET: readonly string[] = ["--timeout", "90000"];

/** The flag as the wrapper takes it: `--parallel=<n>`, and never a value of its own choosing. */
const PARALLEL_FLAG = "--parallel=";

/** What a refusal says, since a silent drop is a gate that ignores what it was asked. */
const PARALLEL_REFUSAL = "`--parallel` wants a worker count: `bun run check --parallel=4`";

/**
 * A test step past this says what a parallel run would have cost.
 *
 * The number is the tree's, not a guess: the sweep every `check` runs is 8.8 s serial and 4.7 s at
 * four workers (`test/README.md#what-a-change-costs`), so a step this long is a hub's selection or a
 * slower machine, and either way it is the one a reader wants named.
 */
export const PARALLEL_HINT_MS = 30_000;

/** What `--parallel=<n>` asked for, or the one sentence that refuses the spelling. */
export function parseParallel(argv: readonly string[]): { parallel?: number; refusal?: string } {
	const argument = argv.find((value) => value === "--parallel" || value.startsWith(PARALLEL_FLAG));
	if (argument === undefined) return {};
	const digits = argument.slice(PARALLEL_FLAG.length);
	if (argument === "--parallel" || !/^[0-9]+$/.test(digits)) return { refusal: PARALLEL_REFUSAL };
	const workers = Number(digits);
	return workers < 1 ? { refusal: PARALLEL_REFUSAL } : { parallel: workers };
}

/**
 * One line for a test step that ran long enough to be worth naming, or `undefined`.
 *
 * The subject is the duration the run actually took, never a prediction: a gate that guessed its own
 * selection size would be a gate whose advice depends on the change under test.
 */
export function hintFor(step: { command: Command; ms: number }): string | undefined {
	const [executable, subcommand] = step.command;
	if (executable !== process.execPath || subcommand !== "test") return undefined;
	if (step.command.some((argument) => argument === "--parallel" || argument.startsWith(PARALLEL_FLAG))) {
		return undefined;
	}
	if (step.ms < PARALLEL_HINT_MS) return undefined;
	const seconds = Math.round(step.ms / 1000);
	return `that step took ${seconds}s serially; \`bun run check --parallel=4\` runs the same gate in about a third of the time (test/README.md#what-a-change-costs)`;
}

const FORMAT: Command = [process.execPath, "run", "check:format"];
const TYPES: Command = [process.execPath, "run", "check:types"];

/** `bun test` under the case budget, over the selection asked for. No selection is the full sweep. */
function tests(facts: Facts, ...selection: readonly string[]): Command {
	return [process.execPath, "test", ...BUDGET, ...parallelFlag(facts), ...selection];
}

/** The flag a caller asked for, in the position the runner reads it: after the budget. */
function parallelFlag(facts: Facts): readonly string[] {
	return facts.parallel === undefined ? [] : [`${PARALLEL_FLAG}${facts.parallel}`];
}

/** The one spelling of the tier's flag, shared by the builder above and the printer below. */
const IGNORE_PREFIX = "--path-ignore-patterns=";

/**
 * The browser tier: the layer's suites a local gate does not run, one exact path at a time.
 *
 * A landing pays this gate on every branch, so `bun run check` keeps the smoke four and ignores the
 * rest; `check:all`, the widened answers below and CI pass no tier and run all of `BROWSER_SUITES`.
 * Exact paths rather than a glob: a mistyped entry then ignores nothing and the gate is slow rather
 * than wrong. A suite added to the layer runs locally until it is named smoke, so an addition costs
 * time and never coverage.
 */
export const BROWSER_TIER: readonly string[] = BROWSER_SUITES.filter((suite) => !SMOKE_SUITES.includes(suite)).map(
	(suite) => `${IGNORE_PREFIX}${suite}`,
);

/**
 * The files a change to which makes the run a change to the *runner*: the test invocation, its
 * preload, the compiler's options, the lockfile. `test/README.md` states the rule; this is what
 * enforces it, so nobody has to remember it on the one morning it matters.
 */
export const RUNNER_FILES: readonly string[] = [
	"package.json",
	"tsconfig.json",
	"bun.lock",
	"bunfig.toml",
	"test/helpers/preload.ts",
	// The layer's declaration is the gate's selection too: a change to it changes what `check` runs.
	"test/helpers/browser-suites.ts",
];

/** What the gate knows before it starts. */
export interface Facts {
	/** `--all` was asked for: `check:all`'s full sweep, whatever the branch says. */
	all?: boolean;
	/** `git diff --name-only main`, or `undefined` when that read could not be made. */
	changed?: readonly string[];
	/**
	 * The worker count a caller asked for with `--parallel=<n>`, or `undefined`.
	 *
	 * Forwarded, never chosen: the gate has no opinion about the machine it is on, and a plan that
	 * changed shape with the size of its own selection would make every card's `verify` depend on the
	 * change under test.
	 */
	parallel?: number;
}

/** The chain to run, and the line that says why it has that shape (`undefined` for the ordinary one). */
export interface Plan {
	commands: readonly Command[];
	why?: string;
}

/**
 * The chain one `check` makes.
 *
 * Four answers, and each of the three wider ones says why: a gate that got bigger silently is as
 * confusing as one that got smaller. The last answer is the only narrow one, and it is narrow only
 * because the first three did not apply.
 */
export function planFor(facts: Facts): Plan {
	const full = (why: string): Plan => ({ commands: [FORMAT, TYPES, tests(facts)], why });
	if (facts.all === true) return full("check:all — the full sweep, asked for");
	// A failed read is not "nothing changed": a shallow clone, a detached HEAD, or a repository whose
	// default branch is elsewhere has no `main`, and guessing narrow there would skip the very suites
	// the change touches. Widen, and say so.
	if (facts.changed === undefined) return full("the branch diff could not be read, so the full sweep runs");
	// No branch to compare with: the same tree a person gates before a release, where everything is owed.
	if (facts.changed.length === 0) return full("there is no branch to narrow against, so the full sweep runs");
	const runner = facts.changed.find((path) => RUNNER_FILES.includes(path));
	if (runner !== undefined) return full(`\`${runner}\` is the runner, so the full sweep runs`);
	return {
		commands: [
			FORMAT,
			TYPES,
			tests(facts, "--changed=main", ...BROWSER_TIER),
			tests(facts, "test/", ...BROWSER_TIER),
		],
	};
}

/**
 * One command as the gate prints it: `bun` for the running interpreter, then its arguments.
 *
 * The browser tier prints as one token, `--path-ignore-patterns=<n> browser suites`, while the argv
 * keeps every exact path: this line is the transcript of what is running, not a command to paste,
 * and thirty-seven flags a line twice a run made it unreadable. The count is the command's own — a
 * line describes the command it prints, never the two lists it came from.
 */
export function display(command: Command): string {
	const parts: string[] = [command[0] === process.execPath ? "bun" : (command[0] ?? "")];
	let ignored = 0;
	for (const argument of command.slice(1)) {
		if (argument.startsWith(IGNORE_PREFIX)) ignored += 1;
		else parts.push(argument);
	}
	if (ignored > 0) parts.push(`${IGNORE_PREFIX}<${ignored} browser suites>`);
	return parts.join(" ");
}

/** `git diff --name-only main`, or `undefined` when git cannot answer. */
function changedSince(cwd: string): readonly string[] | undefined {
	const read = spawnSync("git", ["diff", "--name-only", "main"], { cwd, encoding: "utf8" });
	if (read.error !== undefined || read.status !== 0) return undefined;
	return read.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/**
 * Run the plan, holding the gate's lock, and leave with the first failure's code.
 *
 * `process.exit` is deliberately outside the `try`: it ends the process without unwinding, so a
 * failing gate would leave its lock behind for the next pane to reclaim.
 *
 * `now` is the clock a step is timed with, injected so a case can drive the advice line without
 * waiting for a slow suite: the same seam `createReviewPage`'s `schedule` replaced a fixed sleep with.
 */
export function run(plan: Plan, now: () => number = (): number => performance.now()): never {
	if (plan.why !== undefined) console.error(`check: ${plan.why}`);
	const lock = acquireGate();
	let code = 0;
	try {
		for (const command of plan.commands) {
			console.error(`check: ${display(command)}`);
			const [executable, ...args] = command;
			const started = now();
			const step = spawnSync(executable ?? "", args, { stdio: "inherit" });
			const hint = hintFor({ command, ms: now() - started });
			if (hint !== undefined) console.error(`check: ${hint}`);
			if (step.status !== 0) {
				code = step.status ?? 1;
				break;
			}
		}
	} finally {
		lock?.release();
	}
	process.exit(code);
}

// The import this file's own suite makes must not start a gate: `planFor` is what a case asks, and a
// module that exited on import would take the suite with it.
const asked = parseParallel(process.argv);
if (import.meta.main && asked.refusal !== undefined) {
	console.error(`check: ${asked.refusal}`);
	process.exit(2);
}
const plan = planFor({
	all: process.argv.includes("--all"),
	changed: changedSince(process.cwd()),
	parallel: asked.parallel,
});
if (import.meta.main) run(plan);
