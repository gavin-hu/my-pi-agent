/**
 * `reset()` is a session boundary.
 *
 * The runtime is built once per process and reset on every `session_start`; a child from
 * the session that ended can settle afterwards, and its id is free to be used again. The
 * cases here pin that a reset aborts rather than orphans, and that a late result cannot
 * finish (or free the slot of) a run it does not belong to.
 */

import { describe, expect, test } from "bun:test";
import { BUILTIN_AGENTS } from "./agents.ts";
import { createBackgroundRuntime } from "./background.ts";
import { createResult } from "./stream.ts";
import type { RunOptions } from "./run.ts";
import type { SingleResult } from "./types.ts";
import { makeClock } from "../../test/helpers/clock.ts";
import { settle } from "../../test/helpers/process.ts";

/** A runtime whose runs settle only when the case says so. */
function harness() {
	const clock = makeClock(1_000);
	const entries: Array<Record<string, unknown>> = [];
	const pending: Array<{ options: RunOptions; resolve: (result: SingleResult) => void }> = [];
	const runtime = createBackgroundRuntime({
		appendEntry: (_customType, data) => entries.push(data as Record<string, unknown>),
		now: clock.now,
	});
	const deps = {
		run: (options: RunOptions) => new Promise<SingleResult>((resolve) => pending.push({ options, resolve })),
		agents: BUILTIN_AGENTS,
		defaults: {},
		defaultCwd: "/repo",
		timeoutMs: 0,
		backgroundMax: 4,
	};
	return { runtime, entries, pending, deps };
}

const completed = (task: string): SingleResult => ({
	...createResult("explorer", task),
	exitCode: 0,
	finishedAt: 2_000,
});

describe("a reset boundary", () => {
	test("aborts the run it ends instead of orphaning it", async () => {
		const { runtime, pending, deps } = harness();
		runtime.start({ agent: "explorer", task: "one" }, [], deps);
		// The child is spawned on a microtask, so the run options exist one turn later.
		await settle();
		runtime.reset();
		expect(pending[0]?.options.signal?.aborted).toBe(true);
	});

	test("a late result cannot finish the run that reused its id", async () => {
		const { runtime, entries, pending, deps } = harness();
		runtime.start({ agent: "explorer", task: "one" }, [], deps);
		await settle();
		const first = pending[0];
		runtime.shutdown();
		runtime.reset();
		const second = runtime.start({ agent: "explorer", task: "two" }, [], deps);
		expect(second.ok).toBe(true);
		expect(second.ok && second.run.id).toBe("a1");

		first?.resolve(completed("one"));
		await settle();
		const rows = runtime.list([]);
		expect(rows.map((run) => [run.id, run.task, run.status])).toEqual([["a1", "two", "running"]]);
		// No finish entry for the id: the old child's record belongs to a session that ended.
		expect(entries.filter((entry) => entry.phase === "finish")).toEqual([]);
	});

	test("the new run's own result still finishes it", async () => {
		const { runtime, entries, pending, deps } = harness();
		runtime.reset();
		runtime.start({ agent: "explorer", task: "two" }, [], deps);
		await settle();
		pending[0]?.resolve(completed("two"));
		await settle();
		expect(runtime.list([])[0]?.status).toBe("finished");
		expect(entries.filter((entry) => entry.phase === "finish")).toHaveLength(1);
	});
});
