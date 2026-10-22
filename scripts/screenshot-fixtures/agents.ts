/**
 * The background runs the `/agents` board shows: two settled, one still going.
 */

import type { BackgroundRun } from "../../extensions/subagent/background.ts";
import { now } from "./shared.ts";
import { repo } from "../theme.ts";

/** The background runs the `/agents` board shows. */
export const AGENT_RUNS: BackgroundRun[] = [
	{
		id: "a2",
		agent: "explorer",
		task: "Map the auth module",
		cwd: repo,
		startedAt: now - 12_000,
		status: "running",
	},
	{
		id: "a1",
		agent: "reviewer",
		task: "Review the last diff",
		cwd: repo,
		startedAt: now - 62_000,
		finishedAt: now,
		status: "finished",
		usage: { input: 6200, output: 1800, cacheRead: 0, cacheWrite: 0, cost: 0.04, contextTokens: 8000, turns: 1 },
		output: "The diff is coherent; the only issue is the missing test.",
	},
	{
		id: "a0",
		agent: "worker",
		task: "Fix the parser",
		cwd: repo,
		startedAt: now - 120_000,
		finishedAt: now - 60_000,
		status: "failed",
		exitCode: 1,
		errorMessage: "exit 1",
	},
];
