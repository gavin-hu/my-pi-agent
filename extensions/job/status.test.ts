import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { readExitStatus, STATUS_ENV, withExitTrap } from "./status.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { tempDir } from "../../test/helpers/env.ts";

const temps = makeTempTracker();
afterEach(() => temps.flush());

function statusDir(): string {
	return temps.track(tempDir("pi-jobs-status-"));
}

describe("withExitTrap", () => {
	test("is a no-op on Windows", () => {
		expect(withExitTrap("bun test", true)).toBe("bun test");
	});

	test("prepends an EXIT trap on POSIX and keeps the command intact", () => {
		const program = withExitTrap("bun test", false);
		expect(program).toContain("trap ");
		expect(program).toContain("EXIT");
		expect(program.endsWith("bun test")).toBe(true);
	});
});

// The EXIT trap is shell semantics, so this is the one place the suite runs a
// real shell. It is deterministic (fixed commands and exit codes) and skipped
// on Windows, where the trap is a no-op.
describe("withExitTrap — real shell", () => {
	const realShell = process.platform !== "win32";

	/** Spawn `command` through a real shell with the status trap and wait for exit. */
	async function run(command: string, statusPath: string): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(withExitTrap(command, false), {
				shell: true,
				stdio: "ignore",
				env: { ...process.env, [STATUS_ENV]: statusPath },
			});
			child.on("close", () => resolve());
			child.on("error", reject);
		});
	}

	test.skipIf(!realShell)("records a non-zero exit code", async () => {
		const statusPath = join(statusDir(), "j1.status");
		await run("exit 7", statusPath);
		expect(readExitStatus(statusPath)).toBe(7);
	});

	test.skipIf(!realShell)("records zero for a normal command", async () => {
		const statusPath = join(statusDir(), "j1.status");
		await run("printf hello", statusPath);
		expect(readExitStatus(statusPath)).toBe(0);
	});

	test.skipIf(!realShell)("an exec that replaces the shell bypasses the trap", async () => {
		const statusPath = join(statusDir(), "j1.status");
		await run("exec true", statusPath);
		expect(readExitStatus(statusPath)).toBeUndefined();
	});
});

describe("readExitStatus", () => {
	test("reads a plain integer, tolerating surrounding whitespace", () => {
		const path = join(statusDir(), "j1.status");
		writeFileSync(path, "3\n", "utf-8");
		expect(readExitStatus(path)).toBe(3);
	});

	test("returns 0 for a zero code", () => {
		const path = join(statusDir(), "j1.status");
		writeFileSync(path, "0", "utf-8");
		expect(readExitStatus(path)).toBe(0);
	});

	test("returns undefined for a missing, empty, or malformed file", () => {
		const dir = statusDir();
		expect(readExitStatus(join(dir, "missing.status"))).toBeUndefined();
		expect(readExitStatus(undefined)).toBeUndefined();
		const empty = join(dir, "empty.status");
		writeFileSync(empty, "", "utf-8");
		expect(readExitStatus(empty)).toBeUndefined();
		const bad = join(dir, "bad.status");
		writeFileSync(bad, "boom", "utf-8");
		expect(readExitStatus(bad)).toBeUndefined();
	});
});
