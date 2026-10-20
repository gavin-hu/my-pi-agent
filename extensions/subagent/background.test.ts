import { describe, expect, test } from "bun:test";
import { settle } from "../../test/helpers/process.ts";
import { makeClock } from "../../test/helpers/clock.ts";
import { BUILTIN_AGENTS } from "./agents.ts";
import { BACKGROUND_ENTRY, canCollect, createBackgroundRuntime, backgroundDuration } from "./background.ts";
import type { RunOptions } from "./run.ts";
import { createResult } from "./stream.ts";
import type { SingleResult, UsageStats } from "./types.ts";

const AGENT = BUILTIN_AGENTS[0]!.name;

/** One recorded custom entry. */
function entry(data: unknown): unknown {
	return { type: "custom", customType: BACKGROUND_ENTRY, data };
}

/** A result with one completed turn. */
function result(text = "done", overrides: Partial<SingleResult> = {}): SingleResult {
	const usage: UsageStats = {
		input: 10,
		output: 5,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0.01,
		contextTokens: 20,
		turns: 1,
	};
	return {
		...createResult("explorer", "task"),
		exitCode: 0,
		usage,
		stderr: text,
		finishedAt: 2000,
		...overrides,
	};
}

/** A runtime with one deferred child. */
function harness() {
	const clock = makeClock(1000);
	const records: unknown[] = [];
	let options: RunOptions | undefined;
	let resolveRun: ((value: SingleResult) => void) | undefined;
	const run = (next: RunOptions): Promise<SingleResult> => {
		options = next;
		return new Promise((resolve) => {
			resolveRun = resolve;
		});
	};
	const runtime = createBackgroundRuntime({
		appendEntry: (_type, data) => records.push(entry(data)),
		now: clock.now,
	});
	const start = (branch: readonly unknown[] = [], max = 2) =>
		runtime.start({ agent: AGENT, task: "do the task", cwd: "/repo" }, branch, {
			run,
			agents: BUILTIN_AGENTS,
			defaults: {},
			defaultCwd: "/repo",
			timeoutMs: 1000,
			backgroundMax: max,
		});
	return {
		runtime,
		records,
		clock,
		start,
		run: () => options,
		resolve: (value: SingleResult) => resolveRun?.(value),
	};
}

describe("background runtime", () => {
	test("starts immediately, appends a start entry, and lists it as running", async () => {
		const h = harness();
		const started = h.start();
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		expect(started.run).toMatchObject({ id: "a1", agent: AGENT, status: "running", cwd: "/repo" });
		await settle();

		const run = h.run();
		expect(run?.abortAsResult).toBe(true);
		expect(run?.signal).toBeDefined();
		expect(h.runtime.list([])).toEqual([started.run]);
		expect(h.records).toHaveLength(1);
	});

	test("finishes, appends a finish entry, and collects the output and usage", async () => {
		const h = harness();
		h.start();
		await settle();
		h.clock.advance(1500);
		h.resolve(result("finished output"));
		await settle();

		const runs = h.runtime.list([]);
		expect(runs[0]).toMatchObject({ status: "finished", exitCode: 0, output: "finished output" });
		expect(h.records).toHaveLength(2);
		const collected = h.runtime.collect("a1", []);
		expect(collected).toMatchObject({ ok: true });
		if (!collected.ok) return;
		expect(collected.text).toContain("Background subagent a1");
		expect(collected.text).toContain("finished output");
		expect(collected.text).toContain("Usage:");
	});

	test("cancels one run and reports it as cancelled", async () => {
		const h = harness();
		h.start();
		await settle();
		expect(h.runtime.cancel("a1")).toBe(true);
		h.resolve(result("", { exitCode: 1, stopReason: "aborted", errorMessage: "Aborted" }));
		await settle();

		expect(h.runtime.list([])[0]).toMatchObject({ status: "cancelled", errorMessage: "Aborted" });
	});

	test("refuses more than the configured number of running runs", async () => {
		const h = harness();
		expect(h.start([], 1).ok).toBe(true);
		await settle();
		const second = h.start([], 1);
		expect(second).toEqual({
			ok: false,
			error: "Too many background runs (1); wait for one to finish or cancel it.",
		});
	});

	test("replays start-only entries as interrupted", () => {
		const h = harness();
		const branch = [
			entry({
				phase: "start",
				runId: "a7",
				agent: "explorer",
				task: "old task",
				cwd: "/repo",
				startedAt: 500,
			}),
		];

		expect(h.runtime.list(branch)).toEqual([
			{
				id: "a7",
				agent: "explorer",
				task: "old task",
				cwd: "/repo",
				startedAt: 500,
				status: "interrupted",
			},
		]);
		expect(h.runtime.collect("a7", branch)).toEqual({ ok: false, reason: "a7 was interrupted before it finished." });
	});

	test("replays a finished start/finish pair from the branch", () => {
		const h = harness();
		const branch = [
			entry({
				phase: "start",
				runId: "a3",
				agent: "explorer",
				task: "old task",
				cwd: "/repo",
				startedAt: 500,
			}),
			entry({
				phase: "finish",
				runId: "a3",
				finishedAt: 1500,
				status: "finished",
				exitCode: 0,
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					cost: 0,
					contextTokens: 2,
					turns: 1,
				},
				output: "old output",
			}),
		];

		expect(h.runtime.list(branch)[0]).toMatchObject({
			id: "a3",
			status: "finished",
			output: "old output",
			finishedAt: 1500,
		});
		expect(h.runtime.collect("a3", branch)).toMatchObject({ ok: true, text: expect.stringContaining("old output") });
	});

	test("reset clears a shutdown for a new session", () => {
		const h = harness();
		h.runtime.shutdown();
		expect(h.start().ok).toBe(false);
		h.runtime.reset();
		expect(h.start().ok).toBe(true);
	});

	test("shutdown aborts a live child and drops it from the live list", async () => {
		const h = harness();
		h.start();
		await settle();
		const signal = h.run()?.signal;
		expect(signal?.aborted).toBe(false);
		h.runtime.shutdown();
		expect(signal?.aborted).toBe(true);
		expect(h.runtime.list([])).toEqual([]);
	});

	test("reports duration and collectability", () => {
		const run = {
			id: "a1",
			agent: "explorer",
			task: "task",
			cwd: "/repo",
			startedAt: 1000,
			status: "finished" as const,
		};
		expect(backgroundDuration(run, 2500)).toBe("1.5s");
		expect(canCollect(run)).toBe(true);
		expect(canCollect({ ...run, status: "running" })).toBe(false);
		expect(canCollect({ ...run, status: "interrupted" })).toBe(false);
	});
});
