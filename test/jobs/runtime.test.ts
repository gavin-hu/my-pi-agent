import { describe, expect, test } from "bun:test";
import { loadRegistry, saveRegistry } from "../../extensions/jobs/registry.ts";
import { REGISTRY_VERSION } from "../../extensions/jobs/registry.ts";
import { touchSessionMarker } from "../../extensions/jobs/session.ts";
import type { JobRecord } from "../../extensions/jobs/types.ts";
import { makeCtx, makeHarness, readLog, waitFor, type Harness } from "./helpers.ts";

/** A persisted record belonging to another session. */
function peerRecord(overrides: Partial<JobRecord> = {}): JobRecord {
	return {
		id: "j1",
		label: "peer",
		command: "sleep 99",
		cwd: "/repo",
		pid: 777,
		status: "running",
		exitCode: null,
		signal: null,
		startedAt: 1,
		finishedAt: null,
		logPath: "/tmp/peer.log",
		detached: false,
		wake: false,
		sessionId: "peer",
		seen: false,
		lastLine: "",
		...overrides,
	};
}

function start(h: Harness, command = "sleep 10"): void {
	const { ctx } = makeCtx();
	h.runtime.load(ctx);
	h.runtime.start({ command }, ctx);
}

describe("job runtime — start", () => {
	test("spawns, records a running job, and assigns ids", () => {
		const h = makeHarness();
		try {
			start(h);
			const job = h.runtime.get("j1");
			expect(job?.status).toBe("running");
			expect(job?.pid).toBe(h.children[0].pid);
			expect(h.children[0].command).toBe("sleep 10");
			expect(h.runtime.runningCount()).toBe(1);
		} finally {
			h.cleanup();
		}
	});

	test("uses the label when given and the command otherwise", () => {
		const h = makeHarness();
		try {
			const { ctx } = makeCtx();
			h.runtime.load(ctx);
			expect(h.runtime.start({ command: "bun test", label: "tests" }, ctx).label).toBe("tests");
			expect(h.runtime.start({ command: "bun build" }, ctx).label).toBe("bun build");
		} finally {
			h.cleanup();
		}
	});

	test("streams output into the log file and caches the last line", async () => {
		const h = makeHarness();
		try {
			start(h);
			const job = h.runtime.get("j1")!;
			h.children[0].write("one\n two \n");
			await waitFor(() => h.runtime.get("j1")?.lastLine === "two");
			await waitFor(() => readLog(job.logPath).includes("one"));
			expect(h.runtime.get("j1")?.lastLine).toBe("two");
		} finally {
			h.cleanup();
		}
	});

	test("sanitizes ANSI in the cached last line", async () => {
		const h = makeHarness();
		try {
			start(h);
			h.children[0].write("\u001b[31mred\u001b[0m\n");
			await waitFor(() => h.runtime.get("j1")?.lastLine === "red");
		} finally {
			h.cleanup();
		}
	});

	test("sanitizes a label with escape sequences", () => {
		const h = makeHarness();
		try {
			const { ctx } = makeCtx();
			h.runtime.load(ctx);
			const job = h.runtime.start({ command: "true", label: "\u001b[31mred\u001b[0m" }, ctx);
			expect(job.label).toBe("red");
		} finally {
			h.cleanup();
		}
	});
});

describe("job runtime — finish", () => {
	test("a clean exit becomes exited", () => {
		const h = makeHarness();
		try {
			start(h);
			h.children[0].close(0);
			expect(h.runtime.get("j1")?.status).toBe("exited");
			expect(h.runtime.get("j1")?.exitCode).toBe(0);
			expect(h.runtime.runningCount()).toBe(0);
		} finally {
			h.cleanup();
		}
	});

	test("a non-zero exit becomes failed", () => {
		const h = makeHarness();
		try {
			start(h);
			h.children[0].close(2);
			expect(h.runtime.get("j1")?.status).toBe("failed");
			expect(h.runtime.get("j1")?.exitCode).toBe(2);
		} finally {
			h.cleanup();
		}
	});

	test("a signal close becomes killed", () => {
		const h = makeHarness();
		try {
			start(h);
			h.children[0].close(null, "SIGTERM");
			expect(h.runtime.get("j1")?.status).toBe("killed");
			expect(h.runtime.get("j1")?.signal).toBe("SIGTERM");
		} finally {
			h.cleanup();
		}
	});
});

describe("job runtime — kill", () => {
	test("sends SIGTERM to the process group", () => {
		const h = makeHarness();
		try {
			start(h);
			const pid = h.children[0].pid;
			h.runtime.kill("j1");
			expect(h.kills).toEqual([{ pid, signal: "SIGTERM", force: false }]);
		} finally {
			h.cleanup();
		}
	});

	test("SIGKILL forces and escalates nothing", () => {
		const h = makeHarness();
		try {
			start(h);
			const pid = h.children[0].pid;
			h.runtime.kill("j1", "SIGKILL");
			expect(h.kills[0]).toMatchObject({ pid, signal: "SIGKILL", force: true });
		} finally {
			h.cleanup();
		}
	});

	test("killing a finished job is a no-op", () => {
		const h = makeHarness();
		try {
			start(h);
			h.children[0].close(0);
			h.runtime.kill("j1");
			expect(h.kills).toHaveLength(0);
		} finally {
			h.cleanup();
		}
	});
});

describe("job runtime — logs", () => {
	test("returns a sanitized tail", async () => {
		const h = makeHarness();
		try {
			start(h);
			h.children[0].write("a\nb\nc\n");
			await waitFor(() => h.runtime.get("j1")?.lastLine === "c");
			await waitFor(() => readLog(h.runtime.get("j1")!.logPath).includes("c"));
			const result = h.runtime.logs("j1", 2);
			expect(result?.text).toContain("b");
			expect(result?.text).toContain("c");
			expect(result?.text).not.toContain("\na\n");
			expect(result?.lines).toEqual(["b", "c"]);
			expect(result?.lines.join("\n")).not.toContain("output:");
		} finally {
			h.cleanup();
		}
	});

	test("defaults to the configured maxLogLines", async () => {
		const h = makeHarness({ config: { maxLogLines: 2 } });
		try {
			start(h);
			h.children[0].write("a\nb\nc\nd\n");
			await waitFor(() => h.runtime.get("j1")?.lastLine === "d");
			await waitFor(() => readLog(h.runtime.get("j1")!.logPath).includes("d"));
			const result = h.runtime.logs("j1");
			expect(result?.text).toContain("c");
			expect(result?.text).toContain("d");
			expect(result?.text).not.toContain("\na\n");
		} finally {
			h.cleanup();
		}
	});
});

describe("job runtime — wait", () => {
	test("resolves when the job finishes", async () => {
		const h = makeHarness();
		try {
			start(h);
			const promise = h.runtime.wait("j1", 1000, undefined);
			h.children[0].close(0);
			const result = await promise;
			expect(result?.timedOut).toBe(false);
			expect(result?.job.status).toBe("exited");
		} finally {
			h.cleanup();
		}
	});

	test("times out while the job keeps running", async () => {
		const h = makeHarness();
		try {
			start(h);
			const result = await h.runtime.wait("j1", 0, undefined);
			expect(result?.timedOut).toBe(true);
			expect(h.runtime.get("j1")?.status).toBe("running");
		} finally {
			h.cleanup();
		}
	});

	test("cancels on abort without killing the job", async () => {
		const h = makeHarness();
		try {
			start(h);
			const controller = new AbortController();
			const promise = h.runtime.wait("j1", 10_000, controller.signal);
			controller.abort();
			const result = await promise;
			expect(result?.cancelled).toBe(true);
			expect(h.runtime.get("j1")?.status).toBe("running");
		} finally {
			h.cleanup();
		}
	});
});

describe("job runtime — registry reconcile", () => {
	test("reaps a live non-detached leftover", () => {
		const h = makeHarness();
		try {
			saveRegistry(h.dir, {
				version: REGISTRY_VERSION,
				counter: 2,
				jobs: [
					{
						id: "j1",
						label: "old",
						command: "sleep 99",
						cwd: "/repo",
						pid: 777,
						status: "running",
						exitCode: null,
						signal: null,
						startedAt: 1,
						finishedAt: null,
						logPath: "/tmp/old.log",
						detached: false,
						wake: false,
						sessionId: "old",
						seen: false,
						lastLine: "",
					},
				],
			});
			const { ctx } = makeCtx();
			h.runtime.load(ctx);
			expect(h.kills.some((k) => k.pid === 777 && k.signal === "SIGTERM")).toBe(true);
			expect(h.runtime.get("j1")?.status).toBe("killed");
		} finally {
			h.cleanup();
		}
	});

	test("marks a dead running job as unknown", () => {
		const h = makeHarness();
		try {
			h.dead.add(888);
			saveRegistry(h.dir, {
				version: REGISTRY_VERSION,
				counter: 2,
				jobs: [
					{
						id: "j1",
						label: "old",
						command: "sleep 99",
						cwd: "/repo",
						pid: 888,
						status: "running",
						exitCode: null,
						signal: null,
						startedAt: 1,
						finishedAt: null,
						logPath: "/tmp/old.log",
						detached: false,
						wake: false,
						sessionId: "old",
						seen: false,
						lastLine: "",
					},
				],
			});
			h.runtime.load(makeCtx().ctx);
			expect(h.runtime.get("j1")?.status).toBe("unknown");
		} finally {
			h.cleanup();
		}
	});

	test("refuses to signal a pid whose start token changed", () => {
		const h = makeHarness({ startToken: () => "new" });
		try {
			saveRegistry(h.dir, {
				version: REGISTRY_VERSION,
				counter: 2,
				jobs: [
					{
						id: "j1",
						label: "old",
						command: "sleep 99",
						cwd: "/repo",
						pid: 777,
						status: "running",
						exitCode: null,
						signal: null,
						startedAt: 1,
						finishedAt: null,
						logPath: "/tmp/old.log",
						detached: false,
						wake: false,
						sessionId: "old",
						seen: false,
						lastLine: "",
						startToken: "old",
					},
				],
			});
			h.runtime.load(makeCtx().ctx);
			expect(h.kills).toHaveLength(0);
			expect(h.runtime.get("j1")?.status).toBe("unknown");
		} finally {
			h.cleanup();
		}
	});

	test("polls a reattached detached job when its pid disappears", async () => {
		const h = makeHarness({ config: { repaintMs: 10 } });
		try {
			saveRegistry(h.dir, {
				version: REGISTRY_VERSION,
				counter: 2,
				jobs: [
					{
						id: "j1",
						label: "server",
						command: "dev",
						cwd: "/repo",
						pid: 777,
						status: "running",
						exitCode: null,
						signal: null,
						startedAt: 1,
						finishedAt: null,
						logPath: "/tmp/old.log",
						detached: true,
						wake: false,
						sessionId: "old",
						seen: false,
						lastLine: "",
					},
				],
			});
			h.runtime.load(makeCtx().ctx);
			expect(h.runtime.get("j1")?.status).toBe("running");
			h.dead.add(777);
			await new Promise((resolve) => setTimeout(resolve, 60));
			expect(h.runtime.get("j1")?.status).toBe("unknown");
		} finally {
			h.cleanup();
		}
	});

	test("stops polling reattached jobs while a dock screen hides the rails", async () => {
		const h = makeHarness({ config: { repaintMs: 10 } });
		try {
			saveRegistry(h.dir, {
				version: REGISTRY_VERSION,
				counter: 2,
				jobs: [
					{
						id: "j1",
						label: "server",
						command: "dev",
						cwd: "/repo",
						pid: 777,
						status: "running",
						exitCode: null,
						signal: null,
						startedAt: 1,
						finishedAt: null,
						logPath: "/tmp/old.log",
						detached: true,
						wake: false,
						sessionId: "old",
						seen: false,
						lastLine: "",
					},
				],
			});
			h.runtime.load(makeCtx().ctx);
			expect(h.runtime.get("j1")?.status).toBe("running");
			// Suppressing hides the rails and parks the repaint clock, so the dead
			// pid is not noticed until the screen closes and polling resumes.
			h.runtime.setUiSuppressed(true);
			h.dead.add(777);
			await new Promise((resolve) => setTimeout(resolve, 60));
			expect(h.runtime.get("j1")?.status).toBe("running");
			h.runtime.setUiSuppressed(false);
			await new Promise((resolve) => setTimeout(resolve, 60));
			expect(h.runtime.get("j1")?.status).toBe("unknown");
		} finally {
			h.cleanup();
		}
	});

	test("keeps a live non-detached job owned by another live session", () => {
		const h = makeHarness();
		try {
			touchSessionMarker(h.dir, "peer", 999, Date.now());
			saveRegistry(h.dir, { version: REGISTRY_VERSION, counter: 2, jobs: [peerRecord()] });
			h.runtime.load(makeCtx({ sessionId: "me" }).ctx);
			expect(h.kills.some((k) => k.pid === 777)).toBe(false);
			expect(h.runtime.get("j1")?.status).toBe("running");
		} finally {
			h.cleanup();
		}
	});

	test("reaps a peer job once its owner's marker goes dead", async () => {
		const h = makeHarness({ config: { repaintMs: 10 } });
		try {
			touchSessionMarker(h.dir, "peer", 999, Date.now());
			saveRegistry(h.dir, { version: REGISTRY_VERSION, counter: 2, jobs: [peerRecord()] });
			h.runtime.load(makeCtx({ sessionId: "me" }).ctx);
			expect(h.runtime.get("j1")?.status).toBe("running");
			h.dead.add(999);
			await new Promise((resolve) => setTimeout(resolve, 60));
			expect(h.runtime.get("j1")?.status).toBe("killed");
			expect(h.kills.some((k) => k.pid === 777 && k.signal === "SIGTERM")).toBe(true);
		} finally {
			h.cleanup();
		}
	});
});

describe("job runtime — pending, clear, status", () => {
	test("takePending returns each finished job once", () => {
		const h = makeHarness();
		try {
			start(h);
			h.children[0].close(0);
			expect(h.runtime.takePending().map((j) => j.id)).toEqual(["j1"]);
			expect(h.runtime.takePending()).toEqual([]);
		} finally {
			h.cleanup();
		}
	});

	test("clear removes finished jobs but refuses running ones", () => {
		const h = makeHarness();
		try {
			start(h);
			expect(h.runtime.clear("j1", false).refused).toContain("still running");
			h.children[0].close(0);
			expect(h.runtime.clear(undefined, false).cleared).toBe(1);
			expect(h.runtime.get("j1")).toBeUndefined();
		} finally {
			h.cleanup();
		}
	});

	test("clear all resolves a pending wait", async () => {
		const h = makeHarness();
		try {
			start(h);
			const promise = h.runtime.wait("j1", 10_000, undefined);
			h.runtime.clear(undefined, true);
			const result = await promise;
			expect(result?.timedOut).toBe(false);
		} finally {
			h.cleanup();
		}
	});

	test("clear with all force-removes running jobs", () => {
		const h = makeHarness();
		try {
			start(h);
			const pid = h.children[0].pid;
			expect(h.runtime.clear(undefined, true).cleared).toBe(1);
			expect(h.kills.some((k) => k.pid === pid && k.signal === "SIGKILL")).toBe(true);
			expect(h.runtime.get("j1")).toBeUndefined();
		} finally {
			h.cleanup();
		}
	});

	test("status chip shows the running count and clears at zero", () => {
		const h = makeHarness();
		try {
			const { ctx, statuses } = makeCtx();
			h.runtime.load(ctx);
			h.runtime.setStatus(ctx);
			expect(statuses.has("jobs")).toBe(false);
			h.runtime.start({ command: "sleep 10" }, ctx);
			h.runtime.setStatus(ctx);
			expect(statuses.get("jobs")).toContain("1");
			h.children[0].close(0);
			h.runtime.setStatus(ctx);
			expect(statuses.has("jobs")).toBe(false);
		} finally {
			h.cleanup();
		}
	});

	test("status chip keeps both the running and unreported-failure counts in one token", () => {
		const h = makeHarness();
		try {
			const { ctx, statuses } = makeCtx();
			h.runtime.load(ctx);
			h.runtime.start({ command: "sleep 1" }, ctx); // j1
			h.runtime.start({ command: "sleep 1" }, ctx); // j2, stays running
			h.children[0].close(1); // j1 fails, unreported
			h.runtime.setStatus(ctx);
			// No whitespace, so the status bar's compact form keeps the whole chip.
			expect(statuses.get("jobs")).toBe("▸1·✗1");
		} finally {
			h.cleanup();
		}
	});

	test("re-asserts the chip on the repaint clock after an external clear", async () => {
		const h = makeHarness({ config: { repaintMs: 10 } });
		try {
			const { ctx, statuses } = makeCtx();
			h.runtime.load(ctx);
			h.runtime.start({ command: "sleep 10" }, ctx);
			expect(statuses.get("jobs")).toContain("1");
			// Simulate something clearing the status while the job keeps running.
			statuses.delete("jobs");
			await new Promise((resolve) => setTimeout(resolve, 60));
			expect(statuses.get("jobs")).toContain("1");
		} finally {
			h.cleanup();
		}
	});

	test("shutdown kills non-detached jobs and keeps detached ones", async () => {
		const h = makeHarness();
		try {
			const { ctx } = makeCtx();
			h.runtime.load(ctx);
			h.runtime.start({ command: "a" }, ctx);
			h.runtime.start({ command: "b", detached: true }, ctx);
			const detachedPid = h.children[1].pid;
			await h.runtime.shutdown();
			expect(h.kills.some((k) => k.pid === h.children[0].pid)).toBe(true);
			expect(h.kills.some((k) => k.pid === detachedPid)).toBe(false);
		} finally {
			h.cleanup();
		}
	});

	test("persist preserves a record added to disk by another session", () => {
		const h = makeHarness();
		try {
			const { ctx } = makeCtx({ sessionId: "me" });
			h.runtime.load(ctx);
			saveRegistry(h.dir, {
				version: REGISTRY_VERSION,
				counter: 10,
				jobs: [peerRecord({ id: "j9", detached: true })],
			});
			const job = h.runtime.start({ command: "mine" }, ctx);
			expect(job.id).toBe("j10");
			const ids = loadRegistry(h.dir)
				.jobs.map((j) => j.id)
				.sort();
			expect(ids).toContain("j9");
			expect(ids).toContain("j10");
		} finally {
			h.cleanup();
		}
	});
});

describe("job runtime — widget", () => {
	test("mounts for an unreported failure and hides once it is seen", () => {
		const h = makeHarness();
		try {
			const { ctx, widgets } = makeCtx({ mode: "tui" });
			h.runtime.load(ctx);
			h.runtime.start({ command: "false" }, ctx);
			h.children[0].close(1); // failed, not yet reported
			h.runtime.syncWidget(ctx);
			expect(widgets.get("jobs-widget")).toBeDefined();
			h.runtime.takePending();
			h.runtime.syncWidget(ctx);
			expect(widgets.get("jobs-widget")).toBeUndefined();
		} finally {
			h.cleanup();
		}
	});

	test("setUiSuppressed hides the widget and restores it", () => {
		const h = makeHarness();
		try {
			const { ctx, widgets } = makeCtx({ mode: "tui" });
			h.runtime.load(ctx);
			h.runtime.start({ command: "sleep 10" }, ctx);
			h.runtime.syncWidget(ctx);
			expect(widgets.get("jobs-widget")).toBeDefined();
			h.runtime.setUiSuppressed(true);
			h.runtime.syncWidget(ctx);
			expect(widgets.get("jobs-widget")).toBeUndefined();
			h.runtime.setUiSuppressed(false);
			h.runtime.syncWidget(ctx);
			expect(widgets.get("jobs-widget")).toBeDefined();
		} finally {
			h.cleanup();
		}
	});
});
