/**
 * Fixtures for the tool-rendering gallery (dev tooling).
 *
 * One entry per tool: the call arguments and the `AgentToolResult` a real run
 * would produce, taken from each tool's `details` shape (see the notes in the
 * commit) and matching what its `renderResult` reads. Every path is synthetic —
 * the gallery ships in the repo, so no fixture may name the real workspace.
 *
 * `group` picks how the block is obtained: `builtin` uses Pi's public tool
 * definitions, `package` uses the tool the extension registers, and `transcript`
 * is drawn from bytefly's own nameplate/notice/separator components.
 */

/** The `AgentToolResult` a fixture renders. */
export interface FixtureResult {
	content: Array<{ type: "text"; text: string }>;
	details?: unknown;
	isError?: boolean;
}

/** One gallery entry. */
export interface ToolFixture {
	name: string;
	group: "builtin" | "package" | "transcript";
	/** One line of context shown beside the name in the gallery. */
	label: string;
	/** The call arguments; unused by a `transcript` entry. */
	args?: unknown;
	/** The result the renderer draws; unused by a `transcript` entry. */
	result?: FixtureResult;
	/** Render options, e.g. `expanded` for a block that hides its body. */
	options?: { expanded?: boolean; isPartial?: boolean; argsComplete?: boolean; durationMs?: number };
}

const CWD = "/home/u/repo/project";

export const FIXTURES: ToolFixture[] = [
	// ─── Transcript surfaces ────────────────────────────────────────────────
	{ name: "user-message", group: "transcript", label: "the nameplate above a user message" },
	{ name: "notice", group: "transcript", label: "a shared transcript notice" },
	{ name: "turn-rule", group: "transcript", label: "the rule between completed turns" },

	// ─── Pi built-ins ───────────────────────────────────────────────────────
	{
		name: "read",
		group: "builtin",
		label: "a file excerpt (expanded)",
		args: { path: "src/cli.ts", offset: 1, limit: 8 },
		// A collapsed read renders nothing, so the gallery shows it expanded.
		options: { expanded: true },
		result: {
			content: [
				{
					type: "text",
					text: [
						"#!/usr/bin/env node",
						'import { parseArgs } from "node:util";',
						'import { run } from "./run.js";',
						"",
						'const { values } = parseArgs({ options: { help: { type: "boolean" } } });',
						"",
						"if (values.help) {",
						'  console.log("usage: my-cli [--help]");',
						"}",
					].join("\n"),
				},
			],
		},
	},
	{
		name: "write",
		group: "builtin",
		label: "a created file (content shown on the call)",
		args: {
			path: "src/hello.ts",
			content: ["export function hello(name: string): string {", "  return `Hello, ${name}!`;", "}", ""].join("\n"),
		},
		result: { content: [{ type: "text", text: "Successfully wrote to src/hello.ts" }] },
	},
	{
		name: "edit",
		group: "builtin",
		label: "a diff",
		// `argsComplete: false` skips the renderer's async on-disk preview; the
		// result then supplies `details.diff`, which is what a session shows.
		options: { argsComplete: false },
		args: {
			path: "src/greet.ts",
			edits: [{ oldText: "  return `Hello, ${name}!`;", newText: "  return `Hello, ${name}, welcome back!`;" }],
		},
		result: {
			content: [{ type: "text", text: "Successfully replaced 1 block(s) in src/greet.ts." }],
			details: {
				diff: [
					" 1 export function greet(name: string) {",
					"-2   return `Hello, ${name}!`;",
					"+2   return `Hello, ${name}, welcome back!`;",
					" 3 }",
				].join("\n"),
				patch: "",
				firstChangedLine: 2,
			},
		},
	},
	{
		name: "bash",
		group: "builtin",
		label: "a command that failed (collapsed)",
		args: { command: "bun run check", timeout: 60 },
		options: { expanded: false, durationMs: 1420 },
		result: {
			isError: true,
			content: [
				{
					type: "text",
					text: [
						"Checked 128 files in 214ms",
						"src/cli.ts(12,1): error TS2304: Cannot find name 'run'.",
						"",
						"Command exited with code 1",
					].join("\n"),
				},
			],
		},
	},
	{
		name: "grep",
		group: "builtin",
		label: "matches found so far (still running)",
		args: { pattern: "renderCall", path: "extensions", glob: "*.ts", limit: 100 },
		// The accent rail: a running call is the one block that spends colour.
		options: { isPartial: true },
		result: {
			content: [
				{
					type: "text",
					text: [
						"extensions/read/index.ts:42:     renderCall(call, theme, ctx) {",
						"extensions/read/index.ts:57:     renderResult(result, opts, theme, ctx) {",
						"extensions/edit/index.ts:88:         renderCall,",
						"extensions/edit/index.ts:89:         renderResult,",
					].join("\n"),
				},
			],
		},
	},
	{
		name: "find",
		group: "builtin",
		label: "matched paths",
		args: { pattern: "**/*.test.ts", path: "extensions", limit: 1000 },
		result: {
			content: [
				{
					type: "text",
					text: ["extensions/read/index.test.ts", "extensions/edit/index.test.ts", "extensions/grep/tui.test.ts"].join(
						"\n",
					),
				},
			],
		},
	},
	{
		name: "ls",
		group: "builtin",
		label: "a directory listing",
		args: { path: "extensions/read", limit: 500 },
		result: {
			content: [{ type: "text", text: ["README.md", "index.test.ts", "index.ts", "tui/"].join("\n") }],
		},
	},

	// ─── Package tools ──────────────────────────────────────────────────────
	{
		name: "todo",
		group: "package",
		label: "a task list with every status",
		args: {
			todos: [
				{ content: "Read the existing auth middleware", status: "completed" },
				{ content: "Add the retry wrapper", status: "in_progress", activeForm: "Adding the retry wrapper" },
				{ content: "Write tests for retry behaviour", status: "pending" },
				{ content: "Update the changelog", status: "pending" },
			],
		},
		result: {
			content: [{ type: "text", text: "Todo list updated (4 items; 1 in progress)." }],
			details: {
				action: "write",
				todos: [
					{ content: "Read the existing auth middleware", status: "completed" },
					{ content: "Add the retry wrapper", status: "in_progress", activeForm: "Adding the retry wrapper" },
					{ content: "Write tests for retry behaviour", status: "pending" },
					{ content: "Update the changelog", status: "pending" },
				],
			},
		},
	},
	{
		name: "goal",
		group: "package",
		label: "an active objective",
		args: { objective: "Add rate limiting to the public API", status: "active" },
		result: {
			content: [{ type: "text", text: "Goal set: Add rate limiting to the public API" }],
			details: { action: "set", goal: { objective: "Add rate limiting to the public API", status: "active" } },
		},
	},
	{
		name: "memory",
		group: "package",
		label: "a note added to project memory",
		args: { action: "add", text: "Prefers bun over npm", scope: "project" },
		result: {
			content: [{ type: "text", text: "Added to project memory: Prefers bun over npm" }],
			details: {
				action: "add",
				scope: "project",
				project: ["Prefers bun over npm", "Run bun run check before committing"],
				global: ["User's name is Gavin"],
				changed: true,
				entry: "Prefers bun over npm",
			},
		},
	},
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
		name: "web_fetch",
		group: "package",
		label: "a fetched page",
		args: { url: "https://example.com/docs/retry" },
		result: {
			content: [{ type: "text", text: "Title: Retrying requests\nStatus: 200 (text/html)\n\nMost HTTP clients…" }],
			details: {
				url: "https://example.com/docs/retry",
				finalUrl: "https://example.com/docs/retry",
				title: "Retrying requests",
				status: 200,
				contentType: "text/html; charset=utf-8",
				text: "Most HTTP clients should retry idempotent requests when they fail with a 5xx or a connection error.",
				totalChars: 98,
				startIndex: 0,
				nextIndex: 0,
				truncated: false,
				cached: false,
				matches: [],
				matchesTruncated: false,
				fetchedAt: "2026-03-01T12:00:00.000Z",
				error: "",
			},
		},
	},
	{
		name: "web_search",
		group: "package",
		label: "search results",
		args: { query: "exponential backoff retry best practice", maxResults: 3 },
		result: {
			content: [{ type: "text", text: 'DuckDuckGo results for "exponential backoff retry best practice"' }],
			details: {
				query: "exponential backoff retry best practice",
				provider: "duckduckgo",
				answer: "Exponential backoff retries with jitter and a capped maximum delay.",
				results: [
					{
						title: "Exponential backoff — Wikipedia",
						url: "https://en.wikipedia.org/wiki/Exponential_backoff",
						snippet: "Exponential backoff multiplicatively decreases the rate of a process.",
					},
					{
						title: "Retry with backoff — AWS Architecture Blog",
						url: "https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/",
						snippet: "Add full jitter to avoid retry storms.",
					},
				],
				truncated: false,
				fetchedAt: "2026-03-01T12:01:00.000Z",
			},
		},
	},
	{
		name: "read_doc",
		group: "package",
		label: "an extracted, truncated document",
		args: { path: "docs/architecture.pdf" },
		result: {
			content: [{ type: "text", text: "Path: docs/architecture.pdf\nFormat: pdf\n\n1. Overview\nThe service…" }],
			details: {
				path: "docs/architecture.pdf",
				format: "pdf",
				bytes: 184_320,
				chars: 24_800,
				startIndex: 0,
				nextIndex: 8_000,
				truncated: true,
				text: "1. Overview\nThe service is split into an API tier and a worker tier…",
			},
		},
	},
	{
		name: "open_path",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: { path: "src/http.ts" },
		result: { content: [{ type: "text", text: "Opened /home/u/repo/project/src/http.ts" }] },
	},
	{
		name: "run_doctor",
		group: "package",
		label: "a doctor report with a missing and a degraded finding",
		args: { extension: "bytefly" },
		result: {
			content: [{ type: "text", text: "doctor: 1 missing, 1 degraded across 17 extensions" }],
			details: {
				headline: "doctor: 1 missing, 1 degraded across 17 extensions",
				missing: 1,
				degraded: 1,
				extensions: [
					{
						extension: "wechat",
						enabled: true,
						findings: [
							{
								check: "state file",
								severity: "missing",
								detail: "not logged in",
								hint: "run /wechat login to start the bridge",
							},
							{ check: "qrcode", severity: "ok", detail: "package present" },
						],
					},
					{
						extension: "document",
						enabled: true,
						findings: [
							{
								check: "unpdf",
								severity: "degraded",
								detail: "optional PDF extractor not installed",
								hint: "bun add unpdf to read PDFs",
							},
							{ check: "node", severity: "ok", detail: "v22.5.0 on PATH" },
						],
					},
				],
			},
		},
	},
	{
		name: "send_wechat",
		group: "package",
		label: "a message to the owner",
		args: { text: "The build is green." },
		result: { content: [{ type: "text", text: "Sent to the WeChat owner." }], details: { sent: true } },
	},
	{
		name: "ask_user_question",
		group: "package",
		label: "a two-question answer, one custom",
		args: {
			questions: [
				{
					question: "Which retry policy should I implement?",
					header: "Retry",
					options: [{ label: "Exponential + jitter" }, { label: "Fixed delay" }, { label: "No retries" }],
				},
				{ question: "Any deadline for the retries?", header: "Deadline", options: [{ label: "30s" }, { label: "5m" }] },
			],
		},
		result: {
			content: [{ type: "text", text: "Retry: user selected: 1. Exponential + jitter\nDeadline: user wrote: 60s" }],
			details: {
				cancelled: false,
				questions: [
					{
						id: "q1",
						header: "Retry",
						question: "Which retry policy should I implement?",
						options: [{ label: "Exponential + jitter" }, { label: "Fixed delay" }, { label: "No retries" }],
						allowOther: true,
						multiSelect: false,
					},
					{
						id: "q2",
						header: "Deadline",
						question: "Any deadline for the retries?",
						options: [{ label: "30s" }, { label: "5m" }],
						allowOther: true,
						multiSelect: false,
					},
				],
				answers: [
					{
						id: "q1",
						header: "Retry",
						question: "Which retry policy should I implement?",
						values: ["Exponential + jitter"],
						labels: ["Exponential + jitter"],
						wasCustom: false,
						indices: [1],
					},
					{
						id: "q2",
						header: "Deadline",
						question: "Any deadline for the retries?",
						values: ["60s"],
						labels: ["60s"],
						wasCustom: true,
					},
				],
			},
		},
	},
	{
		name: "enter_plan_mode",
		group: "package",
		label: "plan mode entered",
		args: {},
		result: { content: [{ type: "text", text: "You are now in plan mode." }], details: { entered: true } },
	},
	{
		name: "write_plan",
		group: "package",
		label: "a saved plan",
		args: { title: "Add rate limiting", content: "# Add rate limiting\n" },
		result: {
			content: [{ type: "text", text: "Wrote the plan to .pi/plans/add-rate-limiting.md" }],
			details: {
				path: `${CWD}/.pi/plans/add-rate-limiting.md`,
				relativePath: ".pi/plans/add-rate-limiting.md",
				bytes: 2140,
			},
		},
	},
	{
		name: "exit_plan_mode",
		group: "package",
		label: "an approved plan",
		args: { plan_path: `${CWD}/.pi/plans/add-rate-limiting.md` },
		result: {
			content: [{ type: "text", text: "Plan approved. Plan mode is off and write access is restored." }],
			details: {
				approved: true,
				planPath: `${CWD}/.pi/plans/add-rate-limiting.md`,
				relativePath: ".pi/plans/add-rate-limiting.md",
				plan: [
					"# Add rate limiting",
					"",
					"## Goal",
					"Cap public API traffic per client to avoid overload.",
					"",
					"## Steps",
					"- [ ] Add a token-bucket limiter",
					"- [ ] Wire it into the API middleware",
					"- [ ] Add tests for burst and sustained rates",
				].join("\n"),
			},
		},
	},
	{
		name: "set_plan_steps",
		group: "package",
		label: "one step ticked off",
		args: { plan_path: `${CWD}/.pi/plans/add-rate-limiting.md`, updates: [{ step: 1, status: "completed" }] },
		result: {
			content: [{ type: "text", text: "Step 1 completed (1/3 done)." }],
			details: {
				path: `${CWD}/.pi/plans/add-rate-limiting.md`,
				relativePath: ".pi/plans/add-rate-limiting.md",
				updates: [{ step: 1, status: "completed" }],
				done: 1,
				total: 3,
			},
		},
	},
	{
		name: "enter_worktree",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: { name: "tool-gallery" },
		result: {
			content: [
				{
					type: "text",
					text: `Worktree: tool-gallery\n  path:   ${CWD}/.pi/worktrees/tool-gallery\n  branch: worktree-tool-gallery\n  base:   origin/main (head)\n  main:   ${CWD}`,
				},
			],
			details: {
				state: {
					active: true,
					name: "tool-gallery",
					path: `${CWD}/.pi/worktrees/tool-gallery`,
					branch: "worktree-tool-gallery",
					repoRoot: CWD,
					baseRef: "origin/main",
					baseRefMode: "head",
					createdByUs: true,
				},
			},
		},
	},
	{
		name: "exit_worktree",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: { remove: true },
		result: {
			content: [{ type: "text", text: "Exited worktree tool-gallery and removed it." }],
			details: {
				removed: true,
				state: {
					active: true,
					name: "tool-gallery",
					path: `${CWD}/.pi/worktrees/tool-gallery`,
					branch: "worktree-tool-gallery",
					repoRoot: CWD,
					baseRef: "origin/main",
					baseRefMode: "head",
					createdByUs: true,
				},
			},
		},
	},
	{
		name: "prune_worktrees",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: {},
		result: { content: [{ type: "text", text: "Removed 2 worktrees: feature-auth, fix-typo." }], details: {} },
	},
	{
		name: "list_worktrees",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: {},
		result: {
			content: [
				{
					type: "text",
					text: [
						"Managed worktrees (3):",
						`  ${CWD}/.pi/worktrees/tool-gallery  worktree-tool-gallery  [current]`,
						`  ${CWD}/.pi/worktrees/feature-auth  worktree-feature-auth  [dirty (4), ahead 2]`,
						`  ${CWD}/.pi/worktrees/fix-typo      worktree-fix-typo       [merged, used 3d ago]`,
					].join("\n"),
				},
			],
			details: {
				active: { path: `${CWD}/.pi/worktrees/tool-gallery`, branch: "worktree-tool-gallery", borrowed: false },
				inactiveOverrides: [],
			},
		},
	},
];
