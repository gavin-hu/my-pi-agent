import { afterEach, beforeEach } from "bun:test";

/**
 * Restore environment variables that tests mutate.
 *
 * `--isolate` gives each test file a fresh module registry but the process
 * environment is shared, so a test that sets `PI_CODING_AGENT_DIR` (or any
 * other key) without restoring it can leak into a later file. Snapshotting and
 * restoring around every test keeps the suite order-independent.
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
	for (const key of TRACKED) saved[key] = process.env[key];
});

afterEach(() => {
	for (const key of TRACKED) {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});
