/**
 * The run's clocks: one case budget, and the watchdog a spawned process gets out of it.
 *
 * A wall clock in this suite may only say "this did not finish" — it never makes a passing case
 * faster — so one number is tuned and everything else is derived from it. Two readers state it:
 * `./preload.ts` gives it to every case, and `scripts/check.ts` passes it as `--timeout`, which is
 * also the only form that reaches a suite's hooks. A bare `bun test <path>` therefore budgets a
 * case exactly as the gate does; that disagreement is what let a suite pass under `bun run check`
 * and fail on its own.
 *
 * The number is measured, not guessed. While eight busy loops ran on an eight-core box (load
 * 20-40) the card's two starvations were a `git init` settle at 20.15 s and the `job` exit trap's
 * shell at 25.6 s, both green under `--serial`; the worst of those doubled is where this sat.
 * It rose to 90 s on 2026-11-09, when a spawned `git` in `extensions/plan/git-bash.test.ts` spent
 * 55.11 s — exactly the watchdog this budget derives — beside a second gate on one box, and a
 * loopback page in `extensions/file-browse/transport/root-move.test.ts` reached the case's own
 * deadline in another session; both were green alone and on the re-run, and neither reproduced
 * once the machine-wide gate lock was in place, which is why this is time rather than retries.
 * Raising it is one edit here rather than a third bump of one surface's constant.
 */
export const CASE_BUDGET_MS = 90_000;

/**
 * What a watchdog leaves its case: room to print the failure, land a trap's write, and tear down.
 * A watchdog that fires at the case's own budget has nothing left to say it in.
 */
export const REPORT_MARGIN_MS = 5_000;

/** The one clock for a spawned process — a shell, or a git call — so a red names itself first. */
export const SPAWN_WATCHDOG_MS = CASE_BUDGET_MS - REPORT_MARGIN_MS;
