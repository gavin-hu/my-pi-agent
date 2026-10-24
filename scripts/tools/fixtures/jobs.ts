/**
 * The background-work tools: `job` and `watch`.
 *
 * Both draw as a live list, so the fixtures carry another session's records and
 * a finished turn's summary rather than a single settled call.
 */

import type { ToolFixture } from "./types.ts";
import { CWD } from "./workspace.ts";

/** One entry per background-work tool, in gallery order. */
export const JOB_FIXTURES: ToolFixture[] = [
	{
		name: "job",
		group: "package",
		label: "a finished and a failed background job",
		args: { action: "list" },
		result: {
			content: [{ type: "text", text: "j1 exited 0 · bun test\nj2 failed 1 · bun run build" }],
			details: {
				action: "list",
				jobs: [
					{
						id: "j1",
						label: "bun test",
						command: "bun test",
						cwd: CWD,
						pid: 41234,
						status: "exited",
						exitCode: 0,
						signal: null,
						startedAt: 1_700_000_000_000,
						finishedAt: 1_700_000_012_000,
						logPath: `${CWD}/.pi/jobs/j1.log`,
						detached: false,
						wake: false,
						sessionId: "sess-7f2a",
						seen: true,
						lastLine: "42 pass, 0 fail",
						statusPath: `${CWD}/.pi/jobs/j1.status`,
						startToken: "41234",
					},
					{
						id: "j2",
						label: "bun run build",
						command: "bun run build",
						cwd: CWD,
						pid: 41300,
						status: "failed",
						exitCode: 1,
						signal: null,
						startedAt: 1_700_000_020_000,
						finishedAt: 1_700_000_031_500,
						logPath: `${CWD}/.pi/jobs/j2.log`,
						detached: false,
						wake: true,
						sessionId: "sess-7f2a",
						seen: false,
						lastLine: 'error: Could not resolve "./lib/tui/watcher.ts"',
						statusPath: `${CWD}/.pi/jobs/j2.status`,
						startToken: "41300",
					},
				],
			},
		},
	},
	{
		name: "watch",
		group: "package",
		label: "a running file watcher and an exited command watcher",
		args: { action: "list" },
		result: {
			content: [{ type: "text", text: "w1 app.log errors (running)\nw2 dev server (exited)" }],
			details: {
				action: "list",
				watches: [
					{
						id: "w1",
						label: "app.log errors",
						source: { kind: "file", path: `${CWD}/logs/app.log` },
						pattern: "error",
						exclude: ["healthcheck"],
						caseSensitive: false,
						wake: false,
						fromStart: false,
						status: "running",
						startedAt: 1_700_000_000_000,
						linesRead: 182,
						matchCount: 3,
						lastMatchAt: 1_700_000_045_000,
					},
					{
						id: "w2",
						label: "dev server",
						source: { kind: "command", command: "bun run dev", cwd: CWD },
						pattern: "listening",
						exclude: [],
						caseSensitive: false,
						wake: true,
						fromStart: true,
						status: "exited",
						startedAt: 1_700_000_000_000,
						endedAt: 1_700_000_006_000,
						linesRead: 9,
						matchCount: 1,
						lastMatchAt: 1_700_000_004_000,
						pid: 41400,
						exitCode: 0,
						signal: null,
					},
				],
			},
		},
	},
];
