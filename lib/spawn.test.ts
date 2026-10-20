/**
 * The process seam's pure halves: the spawn options and the kill plan.
 *
 * No process is started here. `spawnOptions` and `killPlan` are decided by the
 * platform, and `applyKillPlan` runs through injected seams, so the fallback
 * order — group, then pid, then give up — is asserted without signalling
 * anything real.
 */

import { describe, expect, test } from "bun:test";
import { applyKillPlan, isPidAlive, killPlan, spawnOptions, type KillSeams } from "./spawn.ts";

const POSIX = "linux";
const WINDOWS = "win32";

describe("spawnOptions", () => {
	test("is a shell in its own process group off Windows", () => {
		const options = spawnOptions({ cwd: "/work" }, POSIX);
		expect(options.shell).toBe(true);
		expect(options.detached).toBe(true);
		expect(options.cwd).toBe("/work");
	});

	test("is not detached on Windows, which has no process group", () => {
		expect(spawnOptions({ cwd: "/work" }, WINDOWS).detached).toBe(false);
	});

	test("closes stdin by default so a read exits instead of blocking", () => {
		expect(spawnOptions({ cwd: "/work" }, POSIX).stdio).toEqual(["ignore", "pipe", "pipe"]);
	});

	test("opens a stdin pipe only when asked", () => {
		expect(spawnOptions({ cwd: "/work", stdin: true }, POSIX).stdio).toEqual(["pipe", "pipe", "pipe"]);
	});

	test("keeps no output pipe for a child that writes its own log", () => {
		expect(spawnOptions({ cwd: "/work", detachOutput: true }, POSIX).stdio).toEqual(["ignore", "ignore", "ignore"]);
		expect(spawnOptions({ cwd: "/work", detachOutput: true, stdin: true }, POSIX).stdio).toEqual([
			"pipe",
			"ignore",
			"ignore",
		]);
	});

	test("passes the environment through untouched", () => {
		const env = { PI_JOB_LOG: "/logs/j1.log" };
		expect(spawnOptions({ cwd: "/work", env }, POSIX).env).toBe(env);
	});
});

describe("killPlan", () => {
	test("signals the process group, then the pid", () => {
		expect(killPlan(4242, false, POSIX)).toEqual({ targets: [-4242, 4242] });
	});

	test("adds no force flag to a POSIX plan, which carries the signal", () => {
		expect(killPlan(4242, true, POSIX)).toEqual({ targets: [-4242, 4242] });
	});

	test("runs taskkill on Windows", () => {
		expect(killPlan(4242, false, WINDOWS)).toEqual({
			command: { file: "taskkill", args: ["/pid", "4242", "/T"] },
			targets: [],
		});
	});

	test("forces the Windows kill when asked", () => {
		expect(killPlan(4242, true, WINDOWS).command?.args).toEqual(["/pid", "4242", "/T", "/F"]);
	});
});

describe("applyKillPlan", () => {
	function seams(behaviour: (pid: number, signal: string) => Error | undefined): {
		kills: Array<{ pid: number; signal: string }>;
		runs: Array<{ file: string; args: string[] }>;
		seams: KillSeams;
	} {
		const kills: Array<{ pid: number; signal: string }> = [];
		const runs: Array<{ file: string; args: string[] }> = [];
		return {
			kills,
			runs,
			seams: {
				kill: (pid, signal) => {
					kills.push({ pid, signal });
					const error = behaviour(pid, signal);
					if (error) throw error;
					return true;
				},
				run: (file, args) => {
					runs.push({ file, args });
					return undefined;
				},
			},
		};
	}

	function errno(code: string): Error {
		return Object.assign(new Error(code), { code });
	}

	test("stops after the group attempt succeeds", () => {
		const { kills, seams: host } = seams(() => undefined);
		applyKillPlan(killPlan(4242, false, POSIX), "SIGTERM", host);
		expect(kills).toEqual([{ pid: -4242, signal: "SIGTERM" }]);
	});

	test("falls back to the pid when the group is not there", () => {
		const { kills, seams: host } = seams((pid) => (pid === -4242 ? errno("ESRCH") : undefined));
		applyKillPlan(killPlan(4242, false, POSIX), "SIGTERM", host);
		expect(kills).toEqual([
			{ pid: -4242, signal: "SIGTERM" },
			{ pid: 4242, signal: "SIGTERM" },
		]);
	});

	test("swallows a failure on the fallback, because the pid is already gone", () => {
		const { seams: host } = seams(() => errno("ESRCH"));
		expect(() => applyKillPlan(killPlan(4242, false, POSIX), "SIGKILL", host)).not.toThrow();
	});

	test("reports a group failure that is not a missing pid", () => {
		const { kills, seams: host } = seams(() => errno("EPERM"));
		expect(() => applyKillPlan(killPlan(4242, false, POSIX), "SIGTERM", host)).toThrow("EPERM");
		expect(kills).toHaveLength(1);
	});

	test("runs the command instead of signalling on Windows", () => {
		const { kills, runs, seams: host } = seams(() => undefined);
		applyKillPlan(killPlan(4242, true, WINDOWS), "SIGTERM", host);
		expect(kills).toEqual([]);
		expect(runs).toEqual([{ file: "taskkill", args: ["/pid", "4242", "/T", "/F"] }]);
	});
});

describe("isPidAlive", () => {
	test("accepts a probe that does not throw", () => {
		expect(isPidAlive(4242, () => true)).toBe(true);
	});

	test("treats EPERM as alive, since the pid exists but is not ours", () => {
		const error = Object.assign(new Error("EPERM"), { code: "EPERM" });
		expect(
			isPidAlive(1, () => {
				throw error;
			}),
		).toBe(true);
	});

	test("treats ESRCH as gone", () => {
		const error = Object.assign(new Error("ESRCH"), { code: "ESRCH" });
		expect(
			isPidAlive(4242, () => {
				throw error;
			}),
		).toBe(false);
	});

	test("refuses an id no process can have, without probing", () => {
		let probed = false;
		const probe = (): boolean => {
			probed = true;
			return true;
		};
		expect(isPidAlive(0, probe)).toBe(false);
		expect(isPidAlive(-1, probe)).toBe(false);
		expect(isPidAlive(Number.NaN, probe)).toBe(false);
		expect(isPidAlive(Number.POSITIVE_INFINITY, probe)).toBe(false);
		expect(probed).toBe(false);
	});
});
