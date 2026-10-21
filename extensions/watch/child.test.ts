import { describe, expect, test } from "bun:test";
import type { KillTreeFn } from "../../lib/spawn.ts";
import { makeFakeSpawn as makeJobSpawn, settle } from "../../test/helpers/fixtures/watch.ts";
import { createChildSupervisor, type ChildSlot, type ChildSink } from "./child.ts";

/** A supervisor over fake children, with every tree-kill recorded. */
function harness(graceMs = 0) {
	const { spawn, children } = makeJobSpawn();
	const kills: Array<{ pid: number; signal: NodeJS.Signals; force?: boolean }> = [];
	const killTree: KillTreeFn = (pid, signal, force) => {
		kills.push({ pid, signal, force });
	};
	const supervisor = createChildSupervisor({ spawn, killTree, graceMs });
	return { supervisor, children, kills };
}

/** A sink that records what the runtime would act on, without a status. */
function sink() {
	const chunks: string[] = [];
	const settled: Array<{ kind: string; code?: number | null; signal?: string | null; message?: string }> = [];
	const record: ChildSink = {
		onData: (chunk) => chunks.push(chunk.toString()),
		onSettled: (outcome) => settled.push(outcome),
	};
	return { record, chunks, settled };
}

describe("createChildSupervisor", () => {
	test("feeds both output streams through one sink", () => {
		const { supervisor, children } = harness();
		const { record, chunks } = sink();
		const slot: ChildSlot = {};

		expect(supervisor.start(slot, "build", "/tmp", record)).toBeUndefined();
		children[0].write("out\n");
		children[0].emitStderr("err\n");

		expect(chunks).toEqual(["out\n", "err\n"]);
		expect(slot.child).toBe(children[0]);
		expect(slot.pid).toBe(children[0].pid);
	});

	test("returns the spawn error and leaves the slot empty", () => {
		const supervisor = createChildSupervisor({
			spawn: () => {
				throw new Error("no such command");
			},
		});
		const slot: ChildSlot = {};

		expect(supervisor.start(slot, "nope", "/tmp", sink().record)).toBe("no such command");
		expect(slot.child).toBeUndefined();
		expect(slot.pid).toBeUndefined();
	});

	test("reports a close with its code and signal", () => {
		const { supervisor, children } = harness();
		const { record, settled } = sink();
		const slot: ChildSlot = {};
		supervisor.start(slot, "build", "/tmp", record);

		children[0].close(2, "SIGTERM");

		expect(settled).toEqual([{ kind: "closed", code: 2, signal: "SIGTERM" }]);
		expect(slot.child).toBeUndefined();
	});

	test("reports an error event as a failure", () => {
		const { supervisor, children } = harness();
		const { record, settled } = sink();
		const slot: ChildSlot = {};
		supervisor.start(slot, "build", "/tmp", record);

		children[0].emit("error", new Error("EACCES"));

		expect(settled).toEqual([{ kind: "failed", message: "EACCES" }]);
	});

	test("terminate sends SIGTERM and escalates to SIGKILL after the grace", async () => {
		const { supervisor, children, kills } = harness();
		const slot: ChildSlot = {};
		supervisor.start(slot, "build", "/tmp", sink().record);

		supervisor.terminate(slot);
		expect(kills).toEqual([{ pid: children[0].pid, signal: "SIGTERM", force: false }]);

		await settle();
		expect(kills).toEqual([
			{ pid: children[0].pid, signal: "SIGTERM", force: false },
			{ pid: children[0].pid, signal: "SIGKILL", force: true },
		]);
	});

	test("a child that closes in time is not force-killed", async () => {
		const { supervisor, children, kills } = harness();
		const slot: ChildSlot = {};
		supervisor.start(slot, "build", "/tmp", sink().record);

		supervisor.terminate(slot);
		children[0].close(null, "SIGTERM");
		await settle();

		expect(kills).toEqual([{ pid: children[0].pid, signal: "SIGTERM", force: false }]);
		expect(slot.killTimer).toBeUndefined();
	});

	test("terminate arms nothing when there is no child", () => {
		const { supervisor, kills } = harness();
		const slot: ChildSlot = {};

		supervisor.terminate(slot);

		expect(kills).toEqual([]);
		expect(slot.killTimer).toBeUndefined();
	});

	test("kill falls back to the child when it has no pid", () => {
		const { supervisor, children } = harness();
		const slot: ChildSlot = {};
		supervisor.start(slot, "build", "/tmp", sink().record);
		slot.pid = undefined;

		supervisor.kill(slot, "SIGKILL");

		expect(children[0].signals).toEqual(["SIGKILL"]);
	});

	test("clearTimer cancels the escalation", async () => {
		const { supervisor, children, kills } = harness();
		const slot: ChildSlot = {};
		supervisor.start(slot, "build", "/tmp", sink().record);

		supervisor.terminate(slot);
		supervisor.clearTimer(slot);
		await settle();

		expect(kills).toHaveLength(1);
		expect(children[0].signals).toEqual([]);
	});

	test("wait resolves once every child has closed", async () => {
		const { supervisor, children } = harness();
		const first: ChildSlot = {};
		const second: ChildSlot = {};
		supervisor.start(first, "a", "/tmp", sink().record);
		supervisor.start(second, "b", "/tmp", sink().record);

		let done = false;
		const waiting = supervisor.wait([first, second], 60_000).then(() => {
			done = true;
		});
		children[0].close();
		await settle();
		expect(done).toBe(false);

		children[1].close();
		await waiting;
		expect(done).toBe(true);
	});

	test("wait resolves after the timeout with a child that never closes", async () => {
		const { supervisor } = harness();
		const slot: ChildSlot = {};
		supervisor.start(slot, "build", "/tmp", sink().record);

		let done = false;
		const waiting = supervisor.wait([slot], 0).then(() => {
			done = true;
		});
		await waiting;
		expect(done).toBe(true);
	});

	test("wait resolves immediately when nothing is alive", async () => {
		const { supervisor } = harness();
		await supervisor.wait([{}], 60_000);
	});
});
