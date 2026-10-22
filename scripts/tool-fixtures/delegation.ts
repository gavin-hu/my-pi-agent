/**
 * The delegated runs: the foreground `subagent` call and the background board.
 *
 * A delegation renders both halves — the agents it ran and what each one did —
 * so the fixture carries the run records, not a prose result.
 */

import type { ToolFixture } from "./types.ts";
import { CWD } from "./workspace.ts";

/** One entry per delegation tool, in gallery order. */
export const DELEGATION_FIXTURES: ToolFixture[] = [
	{
		name: "subagent",
		group: "package",
		label: "a parallel run, one ok and one failed",
		args: {
			tasks: [
				{ agent: "explorer", task: "find the retry logic" },
				{ agent: "worker", task: "run the failing build" },
			],
		},
		result: {
			content: [{ type: "text", text: "parallel: 1 of 2 tasks succeeded." }],
			details: {
				mode: "parallel",
				total: 2,
				agentScope: "user",
				projectAgentsDir: `${CWD}/.pi/agents`,
				readOnly: false,
				results: [
					{
						agent: "explorer",
						agentSource: "builtin",
						task: "find the retry logic",
						exitCode: 0,
						stderr: "",
						messages: [
							{
								role: "assistant",
								content: [{ type: "toolCall", name: "grep", arguments: { pattern: "retry", path: "src" } }],
							},
							{
								role: "assistant",
								content: [
									{
										type: "text",
										text: "`withRetry` in `src/http.ts:42` retries 3 times with exponential backoff.",
									},
								],
							},
						],
						usage: {
							input: 8400,
							output: 320,
							cacheRead: 1200,
							cacheWrite: 0,
							cost: 0.0042,
							contextTokens: 9600,
							turns: 2,
						},
						model: "anthropic/claude-sonnet-4-5",
						stopReason: "end",
						startedAt: 1_700_000_000_000,
						finishedAt: 1_700_000_008_000,
					},
					{
						agent: "worker",
						agentSource: "project",
						task: "run the failing build",
						exitCode: 1,
						stderr: 'error: Could not resolve "./lib/tui/watcher.ts"',
						errorMessage: "build failed: unresolved import",
						messages: [
							{
								role: "assistant",
								content: [{ type: "toolCall", name: "bash", arguments: { command: "bun run build" } }],
							},
						],
						usage: {
							input: 3100,
							output: 90,
							cacheRead: 0,
							cacheWrite: 0,
							cost: 0.0011,
							contextTokens: 3190,
							turns: 1,
						},
						model: "anthropic/claude-sonnet-4-5",
						stopReason: "error",
						startedAt: 1_700_000_000_000,
						finishedAt: 1_700_000_009_000,
					},
				],
			},
		},
	},
	{
		name: "subagent-background",
		group: "package",
		label: "a background run started",
		args: { agent: "explorer", task: "Map the auth module", background: true },
		result: {
			content: [
				{
					type: "text",
					text: "Started explorer as a2 in the background. Use /agents to inspect, collect, or cancel it.",
				},
			],
			details: {
				mode: "single",
				results: [],
				agentScope: "user",
				readOnly: false,
				background: {
					runId: "a2",
					agent: "explorer",
					task: "Map the auth module",
					cwd: `${CWD}`,
					startedAt: 1_700_000_000_000,
				},
			},
		},
	},
];
