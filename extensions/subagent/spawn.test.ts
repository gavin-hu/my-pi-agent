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
