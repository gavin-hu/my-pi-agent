import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { STATUS_ENV, readExitStatus, withExitTrap, LOG_ENV } from "./status.ts";
import { waitFor } from "../../test/helpers/process.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { SPAWN_WATCHDOG_MS } from "../../test/helpers/budget.ts";
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
	 * The shell's deadline, taken once per case and spent by both waits in turn.
	 *
	 * `SPAWN_WATCHDOG_MS` is the one clock for a spawned process (`../../test/helpers/budget.ts`), and the
	 * shell has two waits — its spawn, then the trap's write that lands past `close`. They run in
	 * sequence, so each takes what the other left rather than half the watchdog: the spawn is the half
	 * starved by `--parallel` (25.6 s and 55.11 s are the measurements in `budget.ts`), and splitting
	 * the watchdog gave it 42.5 s, which a loaded four-worker gate overran while the landing was never
	 * the slow half. The sum is still bounded by the watchdog, so a run of both fails inside the case
	 * budget, and `waitFor`'s own expiry still names the test, its site and the budget it spent.
	 */
	const shellDeadline = (): number => performance.now() + SPAWN_WATCHDOG_MS;

	/** What one wait may spend of the shell's deadline: never zero, so `waitFor` reports its own expiry. */
	const left = (deadline: number): number => Math.max(1, deadline - performance.now());

	/** Spawn `command` through a real shell with the status trap, and wait for exit inside `deadline`. */
	async function run(command: string, statusPath: string, deadline: number): Promise<void> {
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
			await waitFor(() => closed, left(deadline));
		} catch (error) {
			// The report is `waitFor`'s and already names the test, the site and the budget: the
			// only thing this half adds is the child it must not leave behind.
			child.kill("SIGKILL");
			throw error;
		}
		if (failure) throw failure;
	}

	/**
	 * The code the trap recorded, once its write lands.
	 *
	 * The trap writes the file as the shell exits, so the write and the child's `close` event race:
	 * read once and a slow machine reads nothing. An expired wait throws, naming this case and the
	 * budget it spent; `undefined` after a landed wait means the trap never wrote, which is what the
	 * `exec` case asserts on its own.
	 */
	async function exitStatusOf(statusPath: string, deadline: number): Promise<number | undefined> {
		await waitFor(() => readExitStatus(statusPath) !== undefined, left(deadline));
		return readExitStatus(statusPath);
	}

	test.skipIf(!realShell)("the EXIT trap records a non-zero exit code", async () => {
		const statusPath = join(statusDir(temps), "j1.status");
		const deadline = shellDeadline();
		await run("exit 7", statusPath, deadline);
		expect(await exitStatusOf(statusPath, deadline)).toBe(7);
	});

	test.skipIf(!realShell)("the EXIT trap records zero for a normal command", async () => {
		const statusPath = join(statusDir(temps), "j1.status");
		const deadline = shellDeadline();
		await run("printf hello", statusPath, deadline);
		expect(await exitStatusOf(statusPath, deadline)).toBe(0);
	});

	test.skipIf(!realShell)("an exec that replaces the shell bypasses the trap", async () => {
		const statusPath = join(statusDir(temps), "j1.status");
		await run("exec true", statusPath, shellDeadline());
		expect(readExitStatus(statusPath)).toBeUndefined();
	});
});
