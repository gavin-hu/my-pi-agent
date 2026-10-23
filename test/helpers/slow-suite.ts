/**
 * Gate for the slow, git-repo-spawning suites.
 *
 * The `rewind` and `worktree` suites and the session-bus real-repository tests
 * create real repositories and run real git commands, which dominates the runtime
 * of `bun run test` and `bun run check`. They run in CI (GitHub Actions sets `CI`)
 * and locally when `PI_SLOW_TESTS=1`; otherwise each gated `describe` is skipped,
 * not deleted, so CI keeps the coverage.
 *
 * Usage: `describe.skipIf(!runSlowSuites)("...", () => { ... })`.
 *
 * A gated suite may still keep a cheap top-level `afterAll` (temp cleanup); it
 * must not create a repository outside the `describe`, or a skipped run pays the
 * cost it was meant to avoid.
 */

/**
 * Whether the slow git-repo suites run in this process. `PI_SLOW_TESTS` must be
 * exactly `"1"`, so an inherited `PI_SLOW_TESTS=0` cannot enable them.
 */
export const runSlowSuites = Boolean(process.env.CI) || process.env.PI_SLOW_TESTS === "1";
