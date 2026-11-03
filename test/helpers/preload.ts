import { afterEach, beforeEach, setDefaultTimeout } from "bun:test";
import { CASE_BUDGET_MS } from "./budget.ts";

/**
 * Give every case the run's one budget, whatever invoked it.
 *
 * Without this a bare `bun test <path>` budgets a case at bun's 5 s while `bun run check` passes
 * `--timeout` (see `./budget.ts`), so the same case passes one way and fails the other. A hook is
 * still bun's own default: `setDefaultTimeout` does not reach `beforeAll`, so a suite whose setup
 * needs longer states its hooks' budget, which `test/wait-budget.test.ts` holds for the browser
 * suites.
 */
setDefaultTimeout(CASE_BUDGET_MS);

/**
 * Restore environment variables that tests mutate.
 *
 * `--isolate` gives each test file a fresh module registry but the process
 * environment is shared, so a test that sets `PI_CODING_AGENT_DIR` (or any
 * other key) without restoring it can leak into a later file. Snapshotting and
 * restoring around every test keeps the suite order-independent.
 *
 * The snapshot is also cleared for the test itself: this suite runs inside a
 * worktree session, which exports `PI_WORKTREE_ROOT`, and an inherited root
 * would silently re-root every test that resolves an effective cwd. A test that
 * wants isolation sets the key itself.
 */
const TRACKED = [
	"PI_CODING_AGENT_DIR",
	"PI_CODING_AGENT_SESSION_DIR",
	"PI_WORKTREE_ROOT",
	"PI_WORKTREE_BRANCH",
	"PI_WORKTREE_MAIN",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved = {};
	for (const key of TRACKED) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of TRACKED) {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});
