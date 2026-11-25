#!/usr/bin/env bun
/**
 * `bun run bench:browser`: what each browser suite costs, against the ceiling it is allowed.
 *
 * The layer is forty files and 257 cases that drive a real Chrome, so it is the only part of the
 * suite whose cost a person notices: it was 108.65 s before #899 and is 57 s after. A number like
 * that regrows one case at a time, and no other gate can see it — `test/suite-sizes.test.ts`
 * measures lines, `test/wait-budget.test.ts` measures stated budgets, and neither knows what a
 * case spends.
 *
 * So each file is run on its own and timed, and `test/helpers/browser-budget.ts` holds the ceiling.
 * The ceilings are measured values with headroom for a loaded machine, and they are a ratchet in
 * the same sense as `LONG_MODULES`: a case that makes a file slower names it in the map, and a
 * map that only ever rises is not a budget. The total is held too, so forty small regressions
 * cannot hide behind forty green files.
 *
 * Each file is run without the pool (`PI_NO_BROWSER_POOL=1`) on purpose: the ceiling is what that
 * file costs with its own launch, because that is the cost a new case adds to and the one a
 * reader comparing two runs is looking at.
 */

import { spawnSync } from "node:child_process";
import { BROWSER_SUITES } from "../test/helpers/browser-suites.ts";
import { BROWSER_FILE_BUDGET_S, BROWSER_TOTAL_BUDGET_S } from "../test/helpers/browser-budget.ts";

/** One file's run: how long it took, and what it was allowed. */
interface Reading {
	path: string;
	seconds: number;
	budget: number;
}

/** Run one suite on its own and time it. */
function timed(path: string): Reading {
	const started = performance.now();
	const run = spawnSync(process.execPath, ["test", path], {
		// No machine lock and no pooled browser: this process is the only thing running, and the
		// number is the file's own cost rather than a share of the run's.
		env: { ...process.env, PI_NO_LOCK: "1", PI_NO_BROWSER_POOL: "1" },
		stdio: ["ignore", "ignore", "inherit"],
	});
	const seconds = (performance.now() - started) / 1000;
	if (run.status !== 0) {
		console.error(`bench: ${path} failed; fix it before its budget means anything`);
		process.exit(run.status ?? 1);
	}
	return { path, seconds, budget: BROWSER_FILE_BUDGET_S[path] ?? Number.POSITIVE_INFINITY };
}

const readings = BROWSER_SUITES.map(timed);
const total = readings.reduce((sum, reading) => sum + reading.seconds, 0);

for (const reading of readings.sort((left, right) => right.seconds - left.seconds)) {
	const over = reading.seconds > reading.budget;
	console.log(
		`${over ? "over" : "ok  "} ${reading.seconds.toFixed(2).padStart(6)}s  ${Number.isFinite(reading.budget) ? `${reading.budget.toFixed(1)}s` : "  —  "}  ${reading.path}`,
	);
}

const over = readings.filter((reading) => reading.seconds > reading.budget);
const undeclared = readings.filter((reading) => !Number.isFinite(reading.budget));
console.log(`\ntotal ${total.toFixed(2)}s of ${BROWSER_TOTAL_BUDGET_S.toFixed(1)}s across ${readings.length} files`);
if (undeclared.length > 0) {
	console.error(`bench: ${undeclared.length} file(s) have no ceiling in test/helpers/browser-budget.ts: name each one`);
}
if (over.length > 0 || total > BROWSER_TOTAL_BUDGET_S) {
	console.error(`bench: ${over.length} file(s) over their ceiling, and the total is ${total.toFixed(2)}s`);
}
process.exit(over.length > 0 || undeclared.length > 0 || total > BROWSER_TOTAL_BUDGET_S ? 1 : 0);
