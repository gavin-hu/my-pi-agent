#!/usr/bin/env bun
/**
 * `bun run check`: the gate a landing needs, behind the lock that makes two panes queue.
 *
 * The three commands are the same chain this script replaced, in the same order, and every caller
 * already runs `bun run check` — the CI jobs and `publish.yml` included — so nothing outside this
 * file had to learn about the lock. A CI runner runs one gate and never contends, which is why
 * nothing about that job changes.
 *
 * The budget rides the command a person types: `bunfig.toml` has no key for `--timeout` and
 * `setDefaultTimeout` does not reach a hook, so the number is written here and
 * `test/wait-budget.test.ts` holds it to `CASE_BUDGET_MS`.
 */

import { spawnSync } from "node:child_process";
import { acquireGate } from "./gate-lock.ts";

/** The chain, in the order `check` has always run it. */
const STEPS: readonly (readonly string[])[] = [
	[process.execPath, "run", "check:format"],
	[process.execPath, "run", "check:types"],
	// 90_000 is `CASE_BUDGET_MS`, and `test/wait-budget.test.ts` is what keeps the two equal.
	[process.execPath, "test", "--timeout", "90000"],
];

const lock = acquireGate();
try {
	for (const [command, ...args] of STEPS) {
		// Inherited stdio, so the gate reads as it always has and a `Ctrl-C` reaches the child
		// through the process group. A signal or a failure still runs the `finally` below.
		const step = spawnSync(command, args, { stdio: "inherit" });
		if (step.status !== 0) process.exit(step.status ?? 1);
	}
} finally {
	lock?.release();
}
