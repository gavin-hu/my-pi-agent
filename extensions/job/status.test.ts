import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { STATUS_ENV, readExitStatus, withExitTrap, LOG_ENV } from "./status.ts";
import { waitFor } from "../../test/helpers/process.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { statusDir } from "../../test/helpers/fixtures/job.ts";

const temps = makeTempTracker();
afterEach(() => temps.flush());

describe("job status files", () => {
	test("withExitTrap is a no-op on Windows", async () => {
		expect(withExitTrap("bun test", true)).toBe("bun test");
	});

	test("withExitTrap prepends an EXIT trap on POSIX and keeps the command intact", async () => {
		const program = withExitTrap("bun test", false);
		expect(program).toContain("trap ");
		expect(program).toContain("EXIT");
		expect(program.endsWith("bun test")).toBe(true);
	});

	test("withExitTrap redirects a detached job's own output to the log file when asked", async () => {
		const program = withExitTrap("bun test", false, true);
		expect(program.startsWith(`exec >> "$${LOG_ENV}" 2>&1\n`)).toBe(true);
		expect(program.endsWith("bun test")).toBe(true);
		expect(withExitTrap("bun test", false)).not.toContain("exec >>");
		expect(withExitTrap("bun test", true, true)).toBe("bun test");
	});

	test("readExitStatus reads a plain integer, tolerating surrounding whitespace", async () => {
		const path = join(statusDir(temps), "j1.status");
		writeFileSync(path, "3\n", "utf-8");
		expect(readExitStatus(path)).toBe(3);
	});

	test("readExitStatus returns 0 for a zero code", async () => {
		const path = join(statusDir(temps), "j1.status");
		writeFileSync(path, "0", "utf-8");
		expect(readExitStatus(path)).toBe(0);
	});

	test("readExitStatus returns undefined for a missing, empty, or malformed file", async () => {
		const dir = statusDir(temps);
		expect(readExitStatus(join(dir, "missing.status"))).toBeUndefined();
		expect(readExitStatus(undefined)).toBeUndefined();
		const empty = join(dir, "empty.status");
		writeFileSync(empty, "", "utf-8");
		expect(readExitStatus(empty)).toBeUndefined();
		const bad = join(dir, "bad.status");
		writeFileSync(bad, "boom", "utf-8");
		expect(readExitStatus(bad)).toBeUndefined();
	});

	// The EXIT trap is shell semantics, so this is the one place the suite runs a
	// real shell. It is deterministic (fixed commands and exit codes) and skipped
	// on Windows, where the trap is a no-op.
	const realShell = process.platform !== "win32";

	/**
	 * How long a real shell gets to exit before the test says it did not.
	 *
	 * A spawn can be starved for seconds while four test files run at once — the hazard
	 * AGENTS.md names for `--parallel`, and the reason CI runs the suite serially — so the
	 * wait is bounded here and reports that, instead of dying on the runner's own 30 s
	 * timeout with a test name and no reason.
	 */
	const SHELL_EXIT_MS = 10_000;
	/** How long the trap's write gets to land: it runs as the shell exits, past `close`. */
	const STATUS_LAND_MS = 2_000;

	/** Spawn `command` through a real shell with the status trap and wait for exit. */
	async function run(command: string, statusPath: string): Promise<void> {
		let closed = false;
		let failure: Error | undefined;
		const child = spawn(withExitTrap(command, false), {
			shell: true,
			stdio: "ignore",
			env: { ...process.env, [STATUS_ENV]: statusPath },
		});
		child.on("close", () => {
			closed = true;
		});
		child.on("error", (error) => {
			failure = error;
			closed = true;
		});
		try {
			// `waitFor` is this suite's one clock; a spawn that never closes names itself
			// here rather than at the runner's own timeout, which says only the test's name.
			await waitFor(() => closed, SHELL_EXIT_MS);
		} catch {
			child.kill("SIGKILL");
			throw new Error(`the shell did not exit within ${SHELL_EXIT_MS}ms`);
		}
		if (failure) throw failure;
	}

	/**
	 * The code the trap recorded, once its write lands.
	 *
	 * The trap writes the file as the shell exits, so the write and the child's `close`
	 * event race: read once and a slow machine reads nothing. `undefined` afterwards means
	 * the trap never wrote, which is what the `exec` case asserts on its own.
	 */
	async function exitStatusOf(statusPath: string): Promise<number | undefined> {
		try {
			await waitFor(() => readExitStatus(statusPath) !== undefined, STATUS_LAND_MS);
		} catch {
			return undefined;
		}
		return readExitStatus(statusPath);
	}

	test.skipIf(!realShell)("the EXIT trap records a non-zero exit code", async () => {
		const statusPath = join(statusDir(temps), "j1.status");
		await run("exit 7", statusPath);
		expect(await exitStatusOf(statusPath)).toBe(7);
	});

	test.skipIf(!realShell)("the EXIT trap records zero for a normal command", async () => {
		const statusPath = join(statusDir(temps), "j1.status");
		await run("printf hello", statusPath);
		expect(await exitStatusOf(statusPath)).toBe(0);
	});

	test.skipIf(!realShell)("an exec that replaces the shell bypasses the trap", async () => {
		const statusPath = join(statusDir(temps), "j1.status");
		await run("exec true", statusPath);
		expect(readExitStatus(statusPath)).toBeUndefined();
	});
});
