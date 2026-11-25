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

const FORMAT: Command = [process.execPath, "run", "check:format"];
const TYPES: Command = [process.execPath, "run", "check:types"];

/** `bun test` under the case budget, over the selection asked for. No selection is the full sweep. */
function tests(...selection: readonly string[]): Command {
	return [process.execPath, "test", ...BUDGET, ...selection];
}

/** The one spelling of the tier's flag, shared by the builder above and the printer below. */
const IGNORE_PREFIX = "--path-ignore-patterns=";

/**
 * The browser tier: the layer's suites a local gate does not run, one exact path at a time.
 *
 * A landing pays this gate on every branch, so `bun run check` keeps the smoke three and ignores the
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
	const full = (why: string): Plan => ({ commands: [FORMAT, TYPES, tests()], why });
	if (facts.all === true) return full("check:all — the full sweep, asked for");
	// A failed read is not "nothing changed": a shallow clone, a detached HEAD, or a repository whose
	// default branch is elsewhere has no `main`, and guessing narrow there would skip the very suites
	// the change touches. Widen, and say so.
	if (facts.changed === undefined) return full("the branch diff could not be read, so the full sweep runs");
	// No branch to compare with: the same tree a person gates before a release, where everything is owed.
	if (facts.changed.length === 0) return full("there is no branch to narrow against, so the full sweep runs");
	const runner = facts.changed.find((path) => RUNNER_FILES.includes(path));
	if (runner !== undefined) return full(`\`${runner}\` is the runner, so the full sweep runs`);
	return { commands: [FORMAT, TYPES, tests("--changed=main", ...BROWSER_TIER), tests("test/", ...BROWSER_TIER)] };
}

/** One command as the gate prints it: `bun` for the running interpreter, then its arguments. */
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
 */
export function run(plan: Plan): never {
	if (plan.why !== undefined) console.error(`check: ${plan.why}`);
	const lock = acquireGate();
	let code = 0;
	try {
		for (const command of plan.commands) {
			console.error(`check: ${display(command)}`);
			const [executable, ...args] = command;
			const step = spawnSync(executable ?? "", args, { stdio: "inherit" });
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
const plan = planFor({ all: process.argv.includes("--all"), changed: changedSince(process.cwd()) });
if (import.meta.main) run(plan);
