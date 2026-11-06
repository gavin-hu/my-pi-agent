/**
 * The child's lifecycle: the deadline's kill, and the grace that follows it.
 *
 * `spawnAndCollect` sends SIGTERM first and SIGKILL only when the child has not
 * closed, so the cases here script a child that ignores TERM and one that obeys
 * it — the first is the shape that used to hang a run forever, because the old
 * guard asked `proc.killed`, which only says a signal was sent.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { runSingleAgent, type RunOptions } from "./run.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeFakeSpawn } from "../../test/helpers/fixtures/subagent.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One run over the fake child, with the escalation grace shortened to test time. */
function options(overrides: Partial<RunOptions>): RunOptions {
	return {
		defaultCwd: temps.track(tempDir("subagent-spawn-")),
		defaults: {},
		agentName: "explorer",
		task: "inspect",
		makeDetails: (results) => ({ mode: "single", results }),
		...overrides,
	};
}

describe("the kill escalation", () => {
	test("sends SIGKILL when the child ignores SIGTERM", async () => {
		const { spawn, children } = makeFakeSpawn();
		const promise = runSingleAgent(options({ spawn, timeoutMs: 5, escalationMs: 20 }));
		await waitFor(() => children.length === 1);
		await waitFor(() => children[0]?.killSignals.includes("SIGTERM") === true);
		// The child has not closed, so the grace must end in a hard kill — the defect was a
		// guard that read `proc.killed` and so skipped this one.
		await waitFor(() => children[0]?.killSignals.includes("SIGKILL") === true);
		expect(children[0]?.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
		children[0]?.close(0);
		await promise;
	});

	test("stops at SIGTERM when the child closes during the grace", async () => {
		const { spawn, children } = makeFakeSpawn();
		const promise = runSingleAgent(options({ spawn, timeoutMs: 5, escalationMs: 30 }));
		await waitFor(() => children.length === 1);
		await waitFor(() => children[0]?.killSignals.includes("SIGTERM") === true);
		children[0]?.close(143);
		await promise;
		// A closed child is settled, so the armed escalation must not fire.
		await settle(60);
		expect(children[0]?.killSignals).toEqual(["SIGTERM"]);
	});
});

describe("the child's process group", () => {
	test("spawns it in its own group, without a shell", async () => {
		const { spawn, children } = makeFakeSpawn((child) => child.close(0));
		await runSingleAgent(options({ spawn }));
		// Own group off Windows, which has none: a group signal is what reaches what the child
		// started, and the argv is the binary's own, so no shell is involved.
		expect(children[0]?.options?.detached).toBe(process.platform !== "win32");
		expect(children[0]?.options?.shell).toBe(false);
	});

	test("signals the tree, not the pid alone, and forces the escalation", async () => {
		const sent: Array<{ pid: number; signal: string; force: boolean | undefined }> = [];
		const killTree = (pid: number, signal: NodeJS.Signals, force?: boolean) => {
			sent.push({ pid, signal, force });
		};
		const controller = new AbortController();
		const { spawn, children } = makeFakeSpawn((child) => {
			child.pid = 4821;
		});

		const promise = runSingleAgent(
			options({ spawn, killTree, signal: controller.signal, abortAsResult: true, escalationMs: 20 }),
		);
		await waitFor(() => children.length === 1);
		controller.abort();

		await waitFor(() => sent.length > 0);
		expect(sent[0]).toEqual({ pid: 4821, signal: "SIGTERM", force: false });
		// The child ignores SIGTERM, so the grace ends in a forced kill of the same tree.
		await waitFor(() => sent.length > 1);
		expect(sent[1]).toEqual({ pid: 4821, signal: "SIGKILL", force: true });

		children[0]?.close(0);
		await promise;
	});
});
