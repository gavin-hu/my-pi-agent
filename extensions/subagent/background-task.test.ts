/**
 * What a background run is given, and what it keeps.
 *
 * The 4 KiB task cap is the session entry's — an entry replays on every branch rebuild, so it is
 * bounded — but it was also slicing the task handed to the child, silently. These cases pin the
 * split: the child gets the task whole, the record keeps a marked abbreviation.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { callTool } from "../../test/helpers/tools.ts";
import type { RunOptions } from "./run.ts";
import { emptyUsage } from "./stream.ts";
import type { SingleResult } from "./types.ts";
import { useEnv } from "../../test/helpers/env.ts";
import { assistantMessage, fakeToolCtx, registerSubagentTool } from "../../test/helpers/fixtures/subagent.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { settle } from "../../test/helpers/process.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

// The effective root is read from the environment; clear a developer's worktree root.
beforeEach(() => {
	useEnv({ PI_WORKTREE_ROOT: undefined });
});

/** The entry's own cap on a stored task, in characters. */
const STORED_TASK_CHARS = 4 * 1024;

function success(agent: string): SingleResult {
	return { agent, task: "t", exitCode: 0, messages: [assistantMessage("done")], stderr: "", usage: emptyUsage() };
}

/** A context with a real branch, which is where a background entry is recorded. */
function backgroundCtx(tool: { pi: { entries: unknown[] } }) {
	return {
		...fakeToolCtx(),
		hasUI: false,
		isProjectTrusted: () => true,
		sessionManager: { getBranch: () => tool.pi.entries },
	};
}

describe("a background run's task", () => {
	test("the child gets the whole task while the entry keeps a marked copy", async () => {
		const seen: RunOptions[] = [];
		const tool = registerSubagentTool(async (options) => {
			seen.push(options);
			return success(options.agentName);
		});
		const task = "audit the route handlers ".repeat(250).slice(0, 5_000);

		const outcome = await callTool(tool, { agent: "explorer", task, background: true }, backgroundCtx(tool));
		await settle();

		expect(seen[0]?.task).toBe(task);
		expect(seen[0]?.task).toHaveLength(5_000);
		const stored = outcome.details.background.task as string;
		expect(stored).toBe(`${task.slice(0, STORED_TASK_CHARS)}…`);
		const entry = tool.pi.entries[0] as { data: { task: string } };
		expect(entry.data.task).toBe(stored);
	});

	test("a task at the cap is stored unchanged, with no ellipsis", async () => {
		const tool = registerSubagentTool(async (options) => success(options.agentName));
		const task = "t".repeat(STORED_TASK_CHARS);

		const outcome = await callTool(tool, { agent: "explorer", task, background: true }, backgroundCtx(tool));
		await settle();

		expect(outcome.details.background.task).toBe(task);
	});
});
