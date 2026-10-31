import { afterEach, describe, expect, test } from "bun:test";
import { KILL_GRACE_MS } from "../../lib/child.ts";
import { readSessionMarker } from "./session.ts";
import { settle } from "../../test/helpers/process.ts";
import { makeCtx, makeHarnessSuite, startJob } from "../../test/helpers/fixtures/job.ts";

const suite = makeHarnessSuite();
afterEach(() => {
	suite.cleanup();
});

describe("job runtime — wait", () => {
	test("resolves when the job finishes", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		const promise = h.runtime.wait("j1", 1000, undefined);
		h.children[0].close(0);
		const result = await promise;
		expect(result?.timedOut).toBe(false);
		expect(result?.job.status).toBe("exited");
	});

	test("returns immediately for a finished job", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		h.children[0].close(0);
		const result = await h.runtime.wait("j1", 10_000, undefined);
		expect(result).toMatchObject({ timedOut: false, cancelled: false });
	});

	test("returns undefined for an unknown job", async () => {
		const h = suite.makeHarness();
		await h.runtime.load(makeCtx().ctx);
		expect(await h.runtime.wait("j9", 0, undefined)).toBeUndefined();
	});

	test("times out while the job keeps running", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		const result = await h.runtime.wait("j1", 0, undefined);
		expect(result?.timedOut).toBe(true);
		expect(h.runtime.get("j1")?.status).toBe("running");
	});

	test("cancels on abort without killing the job", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		const controller = new AbortController();
		const promise = h.runtime.wait("j1", 10_000, controller.signal);
		controller.abort();
		const result = await promise;
		expect(result?.cancelled).toBe(true);
		expect(h.runtime.get("j1")?.status).toBe("running");
	});
});

describe("job runtime — pending, clear, status", () => {
	test("pendingCompletions peeks and markReported marks", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		h.children[0].close(0);
		expect(h.runtime.pendingCompletions().map((entry) => entry.id)).toEqual(["j1"]);
		expect(h.runtime.pendingCompletions().map((entry) => entry.id)).toEqual(["j1"]);
		h.runtime.markReported(["j1"]);
		expect(h.runtime.pendingCompletions()).toEqual([]);
	});

	test("clear removes finished jobs but refuses running ones", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		expect(h.runtime.clear("j1", false).refused).toContain("still running");
		h.children[0].close(0);
		expect(h.runtime.clear(undefined, false).cleared).toBe(1);
		expect(h.runtime.get("j1")).toBeUndefined();
	});

	test("clear refuses an unknown id", async () => {
		const h = suite.makeHarness();
		await h.runtime.load(makeCtx().ctx);
		expect(h.runtime.clear("j9", false)).toEqual({ cleared: 0, refused: 'no job "j9".' });
	});

	test("clear all resolves a pending wait", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		const promise = h.runtime.wait("j1", 10_000, undefined);
		h.runtime.clear(undefined, true);
		const result = await promise;
		expect(result?.timedOut).toBe(false);
	});

	test("clear with all force-removes running jobs", async () => {
		const h = suite.makeHarness();
		await startJob(h);
		const pid = h.children[0].pid;
		expect(h.runtime.clear(undefined, true).cleared).toBe(1);
		expect(h.kills.some((kill) => kill.pid === pid && kill.signal === "SIGKILL")).toBe(true);
		expect(h.runtime.get("j1")).toBeUndefined();
	});

	test("status chip shows the running count and clears at zero", async () => {
		const h = suite.makeHarness();
		const { ctx, statuses } = makeCtx();
		await h.runtime.load(ctx);
		h.runtime.setStatus(ctx);
		expect(statuses.has("jobs")).toBe(false);
		await h.runtime.start({ command: "sleep 10" }, ctx);
		h.runtime.setStatus(ctx);
		expect(statuses.get("jobs")).toBe("▸ 1");
		h.children[0].close(0);
		h.runtime.setStatus(ctx);
		expect(statuses.has("jobs")).toBe(false);
	});

	test("status chips show the running and unreported-failure counts separately", async () => {
		const h = suite.makeHarness();
		const { ctx, statuses } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "sleep 1" }, ctx); // j1
		await h.runtime.start({ command: "sleep 1" }, ctx); // j2, stays running
		h.children[0].close(1); // j1 fails, unreported
		h.runtime.setStatus(ctx);
		expect(statuses.get("jobs")).toBe("▸ 1");
		expect(statuses.get("jobs-failure")).toBe("✗ 1");
	});

	test("re-asserts the chip on the repaint clock after an external clear", async () => {
		const h = suite.makeHarness({ config: { repaintMs: 10 } });
		const { ctx, statuses } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "sleep 10" }, ctx);
		expect(statuses.get("jobs")).toContain("1");
		// Simulate something clearing the status while the job keeps running.
		statuses.delete("jobs");
		await settle(60);
		expect(statuses.get("jobs")).toContain("1");
	});

	test("shutdown kills non-detached jobs, keeps detached ones, and removes the marker", async () => {
		// Detached jobs exist on POSIX only; pin the host rather than the runner's.
		const h = suite.makeHarness({ isWindows: () => false });
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "a" }, ctx);
		await h.runtime.start({ command: "b", detached: true }, ctx);
		const detachedPid = h.children[1].pid;
		await h.runtime.shutdown();
		expect(h.kills.some((kill) => kill.pid === h.children[0].pid)).toBe(true);
		expect(h.kills.some((kill) => kill.pid === detachedPid)).toBe(false);
		expect(readSessionMarker(h.dir, ctx.sessionManager.getSessionId())).toBeUndefined();
	});

	test("shutdown waits the grace for every running job, handle or no handle", async () => {
		// A reattached job has no child to watch, so the window cannot be the children's
		// closes: every running job waits the same one, capped by the shared default.
		const waits: number[] = [];
		const h = suite.makeHarness({
			config: { killGraceMs: 9000 },
			sleep: async (ms) => {
				waits.push(ms);
			},
		});
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "stubborn" }, ctx);

		await h.runtime.shutdown();

		expect(waits).toEqual([KILL_GRACE_MS]);
	});

	test("shutdown waits the configured grace when it is under the cap", async () => {
		const waits: number[] = [];
		const h = suite.makeHarness({
			config: { killGraceMs: 50 },
			sleep: async (ms) => {
				waits.push(ms);
			},
		});
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "stubborn" }, ctx);

		await h.runtime.shutdown();

		expect(waits).toEqual([50]);
	});

	test("shutdown escalates a job that ignores SIGTERM", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		await h.runtime.start({ command: "stubborn" }, ctx);
		const pid = h.children[0].pid;
		await h.runtime.shutdown();
		expect(h.kills.some((kill) => kill.pid === pid && kill.signal === "SIGKILL")).toBe(true);
	});
});
