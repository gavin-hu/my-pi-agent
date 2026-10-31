import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { projectKey } from "./registry.ts";
import { listReservedIds } from "./reservations.ts";
import { LOG_ENV } from "./status.ts";
import { tempDir, withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import {
	jobRecord,
	save,
	runtimeWithFailedSpawn,
	makeCtx,
	readLog,
	makeHarnessSuite,
	startJob,
} from "../../test/helpers/fixtures/job.ts";

const suite = makeHarnessSuite();
const temps = makeTempTracker();
afterEach(() => {
	suite.cleanup();
	temps.flush();
});

describe("job runtime — start", () => {
	test("spawns, records a running job, and assigns ids", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		const entry = h.runtime.get("j1");
		expect(entry?.status).toBe("running");
		expect(entry?.pid).toBe(h.children[0].pid);
		expect(h.children[0].command).toContain("sleep 10");
		expect(h.runtime.runningCount()).toBe(1);
	});

	test("creates the registry directory before reserving an id", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		// A first job in a project whose registry directory does not exist yet
		// must still be able to reserve its id (`O_EXCL` lock inside that dir).
		rmSync(h.dir, { recursive: true, force: true });
		const entry = await h.runtime.start({ command: "sleep 10" }, ctx);
		expect(existsSync(h.dir)).toBe(true);
		expect(entry.id).toBe("j1");
	});

	test("rejects a start when jobs are disabled", async () => {
		const h = suite.makeHarness({ config: { enabled: false } });
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		await expect(h.runtime.start({ command: "true" }, ctx)).rejects.toThrow("jobs are disabled");
	});

	test("uses the label when given and the command otherwise", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		expect((await h.runtime.start({ command: "bun test", label: "tests" }, ctx)).label).toBe("tests");
		expect((await h.runtime.start({ command: "bun build" }, ctx)).label).toBe("bun build");
	});

	test("streams output into the log file and caches the last line", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		const entry = h.runtime.get("j1")!;
		h.children[0].write("one\n two \n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "two");
		await waitFor(() => readLog(entry.logPath).includes("one"));
		expect(h.runtime.get("j1")?.lastLine).toBe("two");
	});

	test("sanitizes ANSI in the cached last line", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		h.children[0].write("\u001b[31mred\u001b[0m\n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "red");
	});

	test("sanitizes a label with escape sequences", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		const entry = await h.runtime.start({ command: "true", label: "\u001b[31mred\u001b[0m" }, ctx);
		expect(entry.label).toBe("red");
	});

	test("records a status path so a POSIX job can recover its exit code", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		const entry = await h.runtime.start({ command: "true" }, ctx);
		if (process.platform === "win32") expect(entry.statusPath).toBeNull();
		else expect(entry.statusPath).toContain(`${entry.id}.status`);
	});

	test("releases the reserved id when the spawn itself fails", async () => {
		const dir = temps.track(tempDir("pi-jobs-spawn-"));
		const runtime = runtimeWithFailedSpawn(dir);
		const { ctx } = makeCtx();
		await runtime.load(ctx);
		await expect(runtime.start({ command: "true" }, ctx)).rejects.toThrow("spawn failed");
		expect(listReservedIds(dir)).toEqual([]);
		expect(runtime.list()).toEqual([]);
	});

	test("auto-kills a job after its timeout", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "sleep 1", timeoutMs: 10 }, ctx);
		const pid = h.children[0].pid;
		await waitFor(() => h.kills.some((kill) => kill.pid === pid && kill.signal === "SIGTERM"));
	});

	test("escalates the timeout kill to SIGKILL after the grace period", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "sleep 1", timeoutMs: 10 }, ctx);
		const pid = h.children[0].pid;
		await waitFor(() => h.kills.some((kill) => kill.pid === pid && kill.signal === "SIGKILL"));
		expect(h.kills.find((kill) => kill.signal === "SIGKILL")?.force).toBe(true);
	});

	test("does not kill a job that finishes before its timeout", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "true", timeoutMs: 20 }, ctx);
		h.children[0].close(0);
		await settle(50);
		expect(h.kills).toHaveLength(0);
	});
});

describe("job runtime — finish", () => {
	test("a clean exit becomes exited", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		h.children[0].close(0);
		expect(h.runtime.get("j1")?.status).toBe("exited");
		expect(h.runtime.get("j1")?.exitCode).toBe(0);
		expect(h.runtime.runningCount()).toBe(0);
	});

	test("a non-zero exit becomes failed", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		h.children[0].close(2);
		expect(h.runtime.get("j1")?.status).toBe("failed");
		expect(h.runtime.get("j1")?.exitCode).toBe(2);
	});

	test("a signal close becomes killed", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		h.children[0].close(null, "SIGTERM");
		expect(h.runtime.get("j1")?.status).toBe("killed");
		expect(h.runtime.get("j1")?.signal).toBe("SIGTERM");
	});

	test("a spawn error settles the job as failed", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		h.children[0].fail("boom");
		expect(h.runtime.get("j1")?.status).toBe("failed");
		expect(h.runtime.get("j1")?.exitCode).toBe(1);
	});

	test("notifies once when a job fails", async () => {
		const h = suite.makeHarness();
		const { ctx, notifications } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "sleep 1", label: "build" }, ctx);
		h.children[0].close(2);
		expect(notifications).toEqual(["Job j1 failed: build (exit 2)"]);
	});

	test("does not notify on a clean exit", async () => {
		const h = suite.makeHarness();
		const { ctx, notifications } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "sleep 1" }, ctx);
		h.children[0].close(0);
		expect(notifications).toEqual([]);
	});

	test("reports a completion to onComplete exactly once", async () => {
		const h = suite.makeHarness();
		const seen: Array<{ id: string; status: string; exitCode: number | null }> = [];
		h.runtime.onComplete = (entry) => seen.push({ id: entry.id, status: entry.status, exitCode: entry.exitCode });
		await startJob(h);
		h.children[0].close(2);
		expect(seen).toEqual([{ id: "j1", status: "failed", exitCode: 2 }]);
	});
});

describe("job runtime — kill", () => {
	test("sends SIGTERM to the process group", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		const pid = h.children[0].pid;
		await h.runtime.kill("j1");
		expect(h.kills).toEqual([{ pid, signal: "SIGTERM", force: false }]);
	});

	test("SIGKILL forces and escalates nothing", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		const pid = h.children[0].pid;
		await h.runtime.kill("j1", "SIGKILL");
		expect(h.kills[0]).toMatchObject({ pid, signal: "SIGKILL", force: true });
	});

	test("killing a finished job is a no-op", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		h.children[0].close(0);
		await h.runtime.kill("j1");
		expect(h.kills).toHaveLength(0);
	});

	test("escalates a SIGTERM to SIGKILL after the grace period", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		const pid = h.children[0].pid;
		await h.runtime.kill("j1", "SIGTERM");
		await waitFor(() => h.kills.some((kill) => kill.pid === pid && kill.signal === "SIGKILL"));
		expect(h.kills.at(-1)).toMatchObject({ pid, signal: "SIGKILL", force: true });
	});

	test("settles a running record with no pid as unknown", async () => {
		const h = suite.makeHarness();
		save(h, "old", [jobRecord({ pid: null })], 2);
		await h.runtime.load(makeCtx().ctx);
		expect(await h.runtime.kill("j1")).toMatchObject({ status: "unknown" });
		expect(h.kills).toHaveLength(0);
	});

	test("reconciles a reattached job after the kill grace period", async () => {
		const h = suite.makeHarness();
		save(h, "old", [jobRecord({ label: "server", command: "dev", detached: true })], 2);
		await h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("running");

		await h.runtime.kill("j1", "SIGTERM");
		await waitFor(() => h.runtime.get("j1")?.status === "killed");
		expect(h.runtime.get("j1")?.signal).toBe("SIGTERM");
	});

	test("reconciles a reattached job killed with SIGKILL, which has no close event", async () => {
		// A reattached job is one this session holds no handle for, so nothing reports its end:
		// the reconcile timer is what settles it, whatever signal was sent.
		const h = suite.makeHarness();
		save(h, "old", [jobRecord({ label: "server", command: "dev", detached: true })], 2);
		await h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("running");

		await h.runtime.kill("j1", "SIGKILL");
		await waitFor(() => h.runtime.get("j1")?.status === "killed");

		expect(h.runtime.get("j1")?.signal).toBe("SIGKILL");
		expect(h.kills.some((kill) => kill.signal === "SIGKILL")).toBe(true);
	});

	test("delivers the signal it was asked for, then escalates", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		const pid = h.children[0].pid;

		await h.runtime.kill("j1", "SIGINT");

		expect(h.kills).toContainEqual({ pid, signal: "SIGINT", force: false });
		await settle(30);
		expect(h.kills).toContainEqual({ pid, signal: "SIGKILL", force: true });
	});
});

describe("job runtime — Windows", () => {
	/** A harness that believes it is Windows, whichever host is running the test. */
	const windows = (options: Parameters<typeof suite.makeHarness>[0] = {}) =>
		suite.makeHarness({ ...options, isWindows: () => true });

	test("refuses an explicit detach, naming every way out", async () => {
		const h = windows();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);

		let message = "";
		try {
			await h.runtime.start({ command: "sleep 60", detached: true }, ctx);
		} catch (error) {
			message = (error as Error).message;
		}

		expect(message).toContain("cannot outlive the session on Windows");
		expect(message).toContain("detached: false");
		expect(message).toContain("WSL");
		expect(message).toContain("subagent");
	});

	test("a refused start spawns nothing and reserves no id", async () => {
		const h = windows();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);

		await expect(h.runtime.start({ command: "sleep 60", detached: true }, ctx)).rejects.toThrow();
		expect(h.children).toHaveLength(0);
		expect(h.runtime.list()).toEqual([]);

		// The next accepted start is the first id, not the one the refusal burned.
		expect((await h.runtime.start({ command: "true" }, ctx)).id).toBe("j1");
	});

	test("ignores a configured detach default instead of failing every start", async () => {
		const h = windows({ config: { detachedByDefault: true } });
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);

		const entry = await h.runtime.start({ command: "true" }, ctx);

		expect(entry.detached).toBe(false);
		expect(entry.statusPath).toBeNull();
	});

	test("starts an attached job when the call asks for one", async () => {
		const h = windows();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);

		const entry = await h.runtime.start({ command: "true", detached: false }, ctx);

		expect(entry.detached).toBe(false);
		// Attached jobs keep a parent-owned log stream and their exit code from the
		// child's own `close`, which is the whole Windows story.
		expect(readLog(entry.logPath)).toBe("");
	});

	test("still detaches on POSIX, so the refusal cannot leak across platforms", async () => {
		const h = suite.makeHarness({ isWindows: () => false });
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);

		expect((await h.runtime.start({ command: "true", detached: true }, ctx)).detached).toBe(true);
	});
});

describe("job runtime — detached output and registry root", () => {
	const posix = process.platform !== "win32";

	test.skipIf(!posix)("gives a detached job its own output and unrefs it", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "serve", detached: true }, ctx);
		const child = h.children[0];
		expect(child.options?.detachOutput).toBe(true);
		expect(child.unrefed).toBe(true);
		expect(String(child.options?.env?.[LOG_ENV])).toContain("j1.log");
	});

	test("keeps the parent pipe for a non-detached job", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "sleep 1" }, ctx);
		expect(h.children[0].options?.detachOutput).toBe(false);
		expect(h.children[0].unrefed).toBe(false);
	});

	test("anchors the registry to the session cwd, not a worktree root set later", async () => {
		await withAgentDir(async (agentDir) => {
			const worktree = temps.track(tempDir("pi-jobs-wt-"));
			const h = suite.makeHarness({ config: { registryDir: undefined } });
			const { ctx } = makeCtx({ cwd: "/repo/main" });
			await withEnv({ PI_WORKTREE_ROOT: worktree }, async () => {
				await h.runtime.load(ctx);
				await h.runtime.start({ command: "sleep 1" }, ctx);
			});
			expect(existsSync(join(agentDir, "jobs", projectKey("/repo/main")))).toBe(true);
			expect(existsSync(join(agentDir, "jobs", projectKey(worktree)))).toBe(false);
		});
	});
});
