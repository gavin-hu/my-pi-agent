/**
 * The process capability: the shell-escape rule, the spawn and kill seams, the
 * bounded-concurrency pool, the one-shot timer, and the pending-report
 * coordinator.
 *
 * No process is started here: every platform decision is taken from its argument
 * and every command runs through an injected seam. The one production default
 * covered is the timer's cancellation, which needs no clock.
 */

import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { noticeMessage, type NoticeMessage } from "./notice.ts";
import { mapConcurrent } from "./pool.ts";
import { createPendingReporter } from "./report.ts";
import { hasShellEscape, isShellEscapable } from "./shell.ts";
import { applyKillPlan, isPidAlive, killPlan, spawnOptions } from "./spawn.ts";
import { defaultTimer } from "./timer.ts";
import { settle } from "../test/helpers/process.ts";

const POSIX = "linux";
const WINDOWS = "win32";

// --- The shell-escape rule --------------------------------------------------

describe("isShellEscapable", () => {
	const escapable = [" ", "\t", "\n", "'", '"', "\\", "$", "`", ";", "&", "|", "<", ">", "(", ")", "{", "}", "[", "]"];

	test("is true for the characters a shell escape reaches", () => {
		for (const char of escapable) expect(isShellEscapable(char), JSON.stringify(char)).toBe(true);
	});

	test("is false for a literal, such as the backslash in a Windows path", () => {
		for (const char of ["a", "p", ":", ".", "0", ""]) {
			expect(isShellEscapable(char), JSON.stringify(char)).toBe(false);
		}
	});

	test("carries no regex state between calls", () => {
		// A global regex would advance `lastIndex` and answer the second call from
		// where the first stopped; the alternation below would then be wrong.
		expect(isShellEscapable(" ")).toBe(true);
		expect(isShellEscapable("a")).toBe(false);
		expect(isShellEscapable(" ")).toBe(true);
		expect(isShellEscapable(";")).toBe(true);
	});
});

describe("hasShellEscape", () => {
	test("is false for a command whose backslashes are literals", () => {
		for (const command of ["git status", "git diff -- extensions\\plan", "git log --format='%h\\t%s'", "a\\b"]) {
			expect(hasShellEscape(command), JSON.stringify(command)).toBe(false);
		}
	});

	test("is true for an escape of a metacharacter, a quote, or a trailing backslash", () => {
		const escaped = [
			"git status \\; rm -rf x",
			"git status \\& rm",
			"git status \\| sh",
			"git diff -- C:\\repo\\\\",
			"git status \\",
			"echo \\'quoted\\'",
		];
		for (const command of escaped) expect(hasShellEscape(command), JSON.stringify(command)).toBe(true);
	});
});

// --- The process seam -------------------------------------------------------

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

	test("carries the signal rather than a force flag on POSIX", () => {
		expect(killPlan(4242, true, POSIX)).toEqual({ targets: [-4242, 4242] });
	});

	test("runs taskkill on Windows, forcing it when asked", () => {
		expect(killPlan(4242, false, WINDOWS)).toEqual({
			command: { file: "taskkill", args: ["/pid", "4242", "/T"] },
			targets: [],
		});
		expect(killPlan(4242, true, WINDOWS).command?.args).toEqual(["/pid", "4242", "/T", "/F"]);
	});
});

describe("applyKillPlan", () => {
	/** Host seams that record signals and programs, answering `behaviour`. */
	function host(behaviour: (pid: number, signal: string) => Error | undefined) {
		const kills: Array<{ pid: number; signal: string }> = [];
		const runs: Array<{ file: string; args: string[] }> = [];
		return {
			kills,
			runs,
			seams: {
				kill: (pid: number, signal: NodeJS.Signals) => {
					kills.push({ pid, signal });
					const error = behaviour(pid, signal);
					if (error) throw error;
					return true;
				},
				run: (file: string, args: string[]) => {
					runs.push({ file, args });
					return undefined;
				},
			},
		};
	}

	/** An errno-shaped failure, the way `process.kill` reports one. */
	function errno(code: string): Error {
		return Object.assign(new Error(code), { code });
	}

	test("stops after the group attempt succeeds", () => {
		const { kills, seams } = host(() => undefined);
		applyKillPlan(killPlan(4242, false, POSIX), "SIGTERM", seams);
		expect(kills).toEqual([{ pid: -4242, signal: "SIGTERM" }]);
	});

	test("falls back to the pid when the group is not there", () => {
		const { kills, seams } = host((pid) => (pid === -4242 ? errno("ESRCH") : undefined));
		applyKillPlan(killPlan(4242, false, POSIX), "SIGTERM", seams);
		expect(kills).toEqual([
			{ pid: -4242, signal: "SIGTERM" },
			{ pid: 4242, signal: "SIGTERM" },
		]);
	});

	test("swallows a failure on the fallback, because the pid is already gone", () => {
		const { seams } = host(() => errno("ESRCH"));
		expect(() => applyKillPlan(killPlan(4242, false, POSIX), "SIGKILL", seams)).not.toThrow();
	});

	test("reports a group failure that is not a missing pid", () => {
		const { kills, seams } = host(() => errno("EPERM"));
		expect(() => applyKillPlan(killPlan(4242, false, POSIX), "SIGTERM", seams)).toThrow("EPERM");
		expect(kills).toHaveLength(1);
	});

	test("runs the command instead of signalling on Windows", () => {
		const { kills, runs, seams } = host(() => undefined);
		applyKillPlan(killPlan(4242, true, WINDOWS), "SIGTERM", seams);
		expect(kills).toEqual([]);
		expect(runs).toEqual([{ file: "taskkill", args: ["/pid", "4242", "/T", "/F"] }]);
	});
});

describe("isPidAlive", () => {
	/** A probe that always throws `code`. */
	function failing(code: string): () => boolean {
		const error = Object.assign(new Error(code), { code });
		return () => {
			throw error;
		};
	}

	test("accepts a probe that does not throw", () => {
		expect(isPidAlive(4242, () => true)).toBe(true);
	});

	test("treats EPERM as alive, since the pid exists but is not ours", () => {
		expect(isPidAlive(1, failing("EPERM"))).toBe(true);
	});

	test("treats ESRCH as gone", () => {
		expect(isPidAlive(4242, failing("ESRCH"))).toBe(false);
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

// --- Bounded concurrency ----------------------------------------------------

describe("mapConcurrent", () => {
	/** A promise the test releases by hand, so no timer or clock is involved. */
	function deferred(): { promise: Promise<void>; resolve: () => void } {
		let resolve: () => void = () => {};
		const promise = new Promise<void>((settle) => {
			resolve = settle;
		});
		return { promise, resolve };
	}

	/** Run over `items` at `limit`, gated, recording the start order and peak width. */
	async function gated(items: readonly number[], limit: number) {
		const gate = deferred();
		const started: number[] = [];
		let inFlight = 0;
		let peak = 0;
		const pending = mapConcurrent(items, limit, async (item) => {
			started.push(item);
			inFlight++;
			peak = Math.max(peak, inFlight);
			await gate.promise;
			inFlight--;
			return item;
		});
		return { gate, started, pending, peak: () => peak };
	}

	test("returns results in input order, not completion order", async () => {
		expect(await mapConcurrent([3, 1, 2], 2, async (item) => item * 10)).toEqual([30, 10, 20]);
	});

	test("fills its width and never exceeds it", async () => {
		const run = await gated([0, 1, 2, 3, 4], 2);
		// The pool fills its width synchronously, then waits on the gate.
		expect(run.started).toEqual([0, 1]);
		expect(run.peak()).toBe(2);

		run.gate.resolve();
		expect(await run.pending).toEqual([0, 1, 2, 3, 4]);
		expect(run.peak()).toBe(2);
	});

	test("a limit of one, or a non-positive one, serializes the work", async () => {
		for (const limit of [1, 0, -3]) {
			const run = await gated([0, 1, 2], limit);
			expect(run.started, String(limit)).toEqual([0]);
			run.gate.resolve();
			expect(await run.pending).toEqual([0, 1, 2]);
			expect(run.peak(), String(limit)).toBe(1);
		}
	});

	test("a limit above the item count runs everything and keeps the order", async () => {
		const run = await gated([0, 1, 2], 100);
		expect(run.peak()).toBe(3);
		run.gate.resolve();
		expect(await run.pending).toEqual([0, 1, 2]);
	});

	test("an empty input calls nothing", async () => {
		let calls = 0;
		const result = await mapConcurrent([], 4, async () => {
			calls++;
			return 0;
		});
		expect(result).toEqual([]);
		expect(calls).toBe(0);
	});

	test("a rejection stops new work and rejects with the original error", async () => {
		const gate = deferred();
		const failure = new Error("first failed");
		const started: number[] = [];

		const pending = mapConcurrent([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 2, async (item) => {
			started.push(item);
			if (item === 0) throw failure;
			await gate.promise;
			return item;
		});

		// Only the width's worth of work was claimed; nothing new starts after that.
		expect(started).toEqual([0, 1]);
		gate.resolve();
		await expect(pending).rejects.toBe(failure);
		expect(started).toEqual([0, 1]);
	});
});

// --- The timer seam ---------------------------------------------------------

describe("defaultTimer", () => {
	test("a cancelled timer never runs its callback", async () => {
		// The firing half is a real clock, which is why callers inject the seam; the
		// cancellation half is decided synchronously and needs no wait.
		let fired = 0;
		const cancel = defaultTimer(0, () => {
			fired += 1;
		});
		cancel();
		await settle();
		expect(fired).toBe(0);
	});
});

// --- The pending-report coordinator -----------------------------------------

describe("createPendingReporter", () => {
	interface Outcome {
		id: string;
	}

	/** A reporter over a queue that records every wake, mark, and `onWoke` batch. */
	function harness(options: { fail?: boolean } = {}) {
		const queued: Outcome[] = [];
		const marked = new Set<string>();
		const woken: NoticeMessage[] = [];
		const wokeBatches: Outcome[][] = [];
		const markedBatches: string[][] = [];
		const reporter = createPendingReporter<Outcome>({
			wake: (notice) => {
				if (options.fail) throw new Error("send failed");
				woken.push(notice);
			},
			pending: () => queued.filter((item) => !marked.has(item.id)),
			markReported: (items) => {
				markedBatches.push(items.map((item) => item.id));
				for (const item of items) marked.add(item.id);
			},
			buildNotice: (items) =>
				noticeMessage({
					content: `${items.length} finished`,
					details: { source: "test", title: `${items.length} finished` },
				}),
			source: "test",
			onWoke: (items) => wokeBatches.push([...items]),
		});
		return {
			reporter,
			queue: (...ids: string[]) => {
				for (const id of ids) queued.push({ id });
			},
			woken,
			wokeBatches,
			markedBatches,
			pending: () => queued.filter((item) => !marked.has(item.id)).map((item) => item.id),
		};
	}

	/** A notice entry for one source, as the session would hand it back. */
	function noticeEntry(source: string): AgentMessage {
		return {
			role: "custom",
			...noticeMessage({ content: source, details: { source, title: source } }),
		} as unknown as AgentMessage;
	}

	test("wakes one turn and reports every queued outcome", () => {
		const h = harness();
		h.queue("a", "b");
		h.reporter.report();
		expect(h.woken).toHaveLength(1);
		expect(h.woken[0]?.content).toBe("2 finished");
		expect(h.wokeBatches).toEqual([[{ id: "a" }, { id: "b" }]]);
		expect(h.markedBatches).toEqual([["a", "b"]]);
	});

	test("does not wake a second turn before the first turn starts", () => {
		const h = harness();
		h.queue("a");
		h.reporter.report();
		// A second outcome arrives in the window before `agent_start`.
		h.queue("b");
		h.reporter.report();
		expect(h.woken).toHaveLength(1);
		expect(h.pending()).toEqual(["b"]);
	});

	test("wakes again after the run settles", () => {
		const h = harness();
		h.queue("a");
		h.reporter.report();
		h.reporter.agentStart();
		h.reporter.agentSettled();
		h.queue("b");
		h.reporter.report();
		expect(h.woken).toHaveLength(2);
	});

	test("queues without waking while the agent is mid-turn", () => {
		const h = harness();
		h.reporter.agentStart();
		h.queue("a");
		h.reporter.report();
		expect(h.woken).toEqual([]);
		expect(h.pending()).toEqual(["a"]);
	});

	test("reports leftovers at the next turn without triggering one", () => {
		const h = harness();
		h.reporter.agentStart();
		h.queue("a", "b");
		h.reporter.report();
		const result = h.reporter.beforeAgentStart();
		expect(result?.message.content).toBe("2 finished");
		expect(h.woken).toEqual([]);
		expect(h.pending()).toEqual([]);
	});

	test("reports nothing when no outcome is queued", () => {
		const h = harness();
		expect(h.reporter.beforeAgentStart()).toBeUndefined();
		h.reporter.report();
		expect(h.woken).toEqual([]);
	});

	test("leaves the burst unmarked when the send throws, so the next turn reports it", () => {
		const h = harness({ fail: true });
		h.queue("a");
		h.reporter.report();
		expect(h.wokeBatches).toEqual([]);
		expect(h.markedBatches).toEqual([]);
		expect(h.reporter.beforeAgentStart()?.message.content).toBe("1 finished");
	});

	test("clears both flags for a new session", () => {
		const h = harness();
		h.queue("a");
		h.reporter.report();
		h.reporter.sessionStart();
		h.queue("b");
		h.reporter.report();
		expect(h.woken).toHaveLength(2);
	});

	test("prunes only its own stale notices", () => {
		const h = harness();
		const plain = { role: "user", content: "hi" } as unknown as AgentMessage;
		const other = noticeEntry("other");
		const stale = noticeEntry("test");
		const newest = noticeEntry("test");
		const result = h.reporter.filterContext([other, stale, plain, newest]);
		expect(result?.messages).toEqual([other, plain, newest]);
	});

	test("leaves the context alone when nothing is stale", () => {
		const h = harness();
		expect(h.reporter.filterContext([noticeEntry("test")])).toBeUndefined();
	});
});
