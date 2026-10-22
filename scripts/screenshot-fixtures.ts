/**
 * The fixtures the docs screenshots are drawn around (dev tooling).
 *
 * Each one is hand-written data for a real component: the todo list, a job
 * table, a rewind timeline, a plan, a check result, a watch list, the picker
 * panel. They live here so `screenshots.ts` is the frames and the capture is a
 * separate module, and so a test can render every frame without either.
 *
 * Nothing here touches a host surface or this machine: every path, domain, and
 * name is invented, so no capture prints a real checkout.
 */

import type { TUI } from "@earendil-works/pi-tui";
import { settingViews, type SettingsSnapshot } from "../extensions/bytefly/panel/settings.ts";
import type { SettingsSurface } from "../extensions/bytefly/panel/settings-runtime.ts";
import type { ResourceItem, Settings } from "../extensions/bytefly/picker/types.ts";
import { CheckResult } from "../extensions/check/types.ts";
import type { JobRecord } from "../extensions/job/types.ts";
import type { MemoryEntries } from "../extensions/memory/format.ts";
import type { MemoryPickerCallbacks } from "../extensions/memory/tui.ts";
import { sectionDigests } from "../extensions/plan/plan-text.ts";
import type { StoredPlan } from "../extensions/plan/plans.ts";
import type { Question } from "../extensions/question/types.ts";
import type { ReviewEntry } from "../extensions/rewind/paths.ts";
import type { RewindPoint } from "../extensions/rewind/timeline.ts";
import type { BackgroundRun } from "../extensions/subagent/background.ts";
import type { Todo } from "../extensions/todo/types.ts";
import type { WatchRecord } from "../extensions/watch/types.ts";
import type { BridgeStatus } from "../extensions/wechat/bridge.ts";
import { statusView } from "../extensions/wechat/status-screen.ts";
import type { BotCredentials } from "../extensions/wechat/types.ts";
import type { ExtensionReport } from "../lib/requirements.ts";
import { makeFinding, makeReport } from "../test/helpers/fixtures/doctor.ts";
import { packageExtension } from "../test/helpers/fixtures/picker.ts";
import { repo } from "./theme.ts";

/** The default Terminal window size in logical points; a screen may ask for its own. */
export const WINDOW_BOUNDS = { left: 80, top: 80, right: 880, bottom: 400 };

/** A no-op `requestRender`, for a frame a test or a capture draws. */
export const noop = (): void => {};
/** One clock for every fixture, so the ages and timestamps within a frame agree. */
export const now = Date.now();

export const TODOS: Todo[] = [
	{ content: "Extract the shared design system into lib/tui", status: "completed" },
	{ content: "Rebuild the bytefly chrome on the kit", status: "completed" },
	{ content: "Migrate the todo, memory, and rewind screens", status: "completed" },
	{
		content: "Migrate the job and watch list screens",
		status: "in_progress",
		activeForm: "Migrating the job and watch screens",
	},
	{ content: "Give the question dialog a height-aware layout", status: "pending" },
	{ content: "Draw the plan review overlay from the kit", status: "pending" },
	{ content: "Refresh the README screenshots", status: "pending" },
];

/** A stand-in project path, so no capture prints this machine's own paths. */
export const DEMO_CWD = "/home/u/repo";

export const JOBS: JobRecord[] = [
	{
		id: "j1",
		label: "bun test --watch",
		command: "bun test --watch",
		cwd: DEMO_CWD,
		pid: 48213,
		status: "running",
		exitCode: null,
		signal: null,
		startedAt: now - 81_000,
		finishedAt: null,
		logPath: "/tmp/pi-jobs/j1.log",
		detached: false,
		wake: false,
		stdin: false,
		sessionId: "s1",
		seen: false,
		lastLine: "✓ extensions/todo/tui.test.ts",
		statusPath: "/tmp/pi-jobs/j1.status",
		startToken: "48213",
	},
	{
		id: "j2",
		label: "bun run dev",
		command: "bun run dev",
		cwd: DEMO_CWD,
		pid: 48240,
		status: "running",
		exitCode: null,
		signal: null,
		startedAt: now - 12_000,
		finishedAt: null,
		logPath: "/tmp/pi-jobs/j2.log",
		detached: true,
		wake: false,
		stdin: false,
		sessionId: "s1",
		seen: false,
		lastLine: "vite ready in 203 ms — http://localhost:5174/",
		statusPath: "/tmp/pi-jobs/j2.status",
		startToken: "48240",
	},
	{
		id: "j3",
		label: "bun run typecheck",
		command: "bun run typecheck",
		cwd: DEMO_CWD,
		pid: null,
		status: "exited",
		exitCode: 0,
		signal: null,
		startedAt: now - 240_000,
		finishedAt: now - 228_000,
		logPath: "/tmp/pi-jobs/j3.log",
		detached: false,
		wake: false,
		stdin: false,
		sessionId: "s1",
		seen: true,
		lastLine: "",
		statusPath: null,
		startToken: null,
	},
	{
		id: "j4",
		label: "bun run check",
		command: "bun run check",
		cwd: DEMO_CWD,
		pid: null,
		status: "failed",
		exitCode: 1,
		signal: null,
		startedAt: now - 600_000,
		finishedAt: now - 553_000,
		logPath: "/tmp/pi-jobs/j4.log",
		detached: false,
		wake: false,
		stdin: false,
		sessionId: "s1",
		seen: false,
		lastLine: "error: 2 tests failed",
		statusPath: null,
		startToken: null,
	},
];

export const REWIND_POINTS: RewindPoint[] = [
	{
		entryId: "e5",
		prompt: "Refresh the README screenshots",
		summary: "Refresh the README screenshots",
		timestamp: now - 4 * 60_000,
		snapshot: {
			id: "s5",
			ref: "refs/pi/rewind/s5",
			commit: "a1b2c3d",
			reason: "auto",
			timestamp: now - 4 * 60_000,
			root: repo,
			head: "a1b2c3d",
			clean: true,
			includeUntracked: true,
			sessionId: "s1",
			entryId: "e5",
		},
	},
	{
		entryId: "e4",
		prompt: "Draw the plan review overlay from the kit",
		summary: "Draw the plan review overlay from the kit",
		timestamp: now - 46 * 60_000,
		snapshot: {
			id: "s4",
			ref: "refs/pi/rewind/s4",
			commit: "9f8e7d6",
			reason: "auto",
			timestamp: now - 46 * 60_000,
			root: repo,
			head: "9f8e7d6",
			clean: false,
			includeUntracked: true,
			sessionId: "s1",
			entryId: "e4",
		},
	},
	{
		entryId: "e3",
		prompt: "Fix the header rule on narrow terminals",
		summary: "Fix the header rule on narrow terminals",
		timestamp: now - 3 * 60 * 60_000,
	},
	{
		entryId: "e2",
		prompt: "Merge the job and watch list screens",
		summary: "Merge the job and watch list screens",
		timestamp: now - 5 * 60 * 60_000,
	},
	{
		entryId: "e1",
		prompt: "Start the design system sweep",
		summary: "Start the design system sweep",
		timestamp: now - 26 * 60 * 60_000,
		snapshot: {
			id: "s1",
			ref: "refs/pi/rewind/s1",
			commit: "1a2b3c4",
			reason: "auto",
			timestamp: now - 26 * 60 * 60_000,
			root: repo,
			head: "1a2b3c4",
			clean: true,
			includeUntracked: true,
			sessionId: "s1",
			entryId: "e1",
		},
	},
];

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

/** The failed check the `/check` screen shows. */
export const CHECK_RESULT: CheckResult = {
	target: "all",
	status: "failed",
	commands: ["bun run check"],
	exitCode: 1,
	durationMs: 12_400,
	truncated: false,
	failures: [
		{
			path: "extensions/check/detect.test.ts",
			line: 56,
			column: 21,
			message: 'expected "cargo test" to be "cargo test --all"',
			command: "bun run check",
		},
		{
			path: "extensions/check/failures.test.ts",
			line: 41,
			message: "expected 2 failures, got 0",
			command: "bun run check",
		},
		{ test: "TestDetect", message: "Test failed", command: "go test ./..." },
	],
	tail: "src/check.test.ts:12: nope\nmore output",
};

/** The changed files the review screen shows after a documentation turn. */
export const REVIEW_ENTRIES: ReviewEntry[] = [
	{ path: "extensions/rewind/review.ts", change: "modified", added: 42, removed: 3 },
	{ path: "extensions/rewind/review-tui.ts", change: "added", added: 180, removed: 0 },
	{ path: "extensions/rewind/commands.ts", change: "modified", added: 6, removed: 1 },
	{ path: "assets/review.png", change: "added", added: null, removed: null },
];

/** The plan the review screen shows; its `Steps` section changed on this review. */
export const PLAN_PATH = "/home/u/repo/.pi/plans/2026-10-18-1430-plan-review-change-marks.md";
export const PLAN_CONTENT = [
	"# Plan review: mark the sections that changed",
	"",
	"## Goal",
	"",
	"Show a returning reviewer what changed since the last review, without leaving the plan review screen.",
	"",
	"## Context",
	"",
	"- The body renders through Pi's `Markdown`, so headings, lists, and code already match the rest.",
	"- What is missing for a second review is the notice that a section was revised, and a position readout.",
	"",
	"## Approach",
	"",
	"- Persist the per-section digests of the reviewed plan with the approval.",
	"- Diff the new plan against them and mark every heading that changed.",
	"- Draw the scroll gauge from the shared kit, with `n`/`p` section jumps.",
	"- Rejected: comparing whole plans, because one edited word would flag every section.",
	"",
	"## Visual",
	"",
	"The scroll row on a second review:",
	"",
	"```",
	"▰▰▰▰▰▱▱▱▱▱ 52%  ≡ Steps · changed  lines 12–31 of 42",
	"```",
	"",
	"## Steps",
	"",
	"- [x] Store the review baseline alongside the approval",
	"  - `runtime.ts` already persists the mode entry; this adds one field to it.",
	"- [x] Diff sections on the next review",
	"- [x] Draw the gauge from the shared kit",
	"- [ ] Mark changed headings in the section label",
	"- [ ] Cover a second review in `tui.test.ts`",
	"",
	"## Risks",
	"",
	"- A plan edited outside Pi has no baseline, so the marks only appear on a second review.",
	"- The digests add state to the approval entry, which `/resume` must rebuild.",
	"",
	"## Verification",
	"",
	"```bash",
	"bun test extensions/plan",
	"bun run check",
	"```",
].join("\n");
export const PLAN: StoredPlan = {
	path: PLAN_PATH,
	relativePath: ".pi/plans/2026-10-18-1430-plan-review-change-marks.md",
	content: PLAN_CONTENT,
	bytes: Buffer.byteLength(PLAN_CONTENT),
};
/**
 * The digests the previous review saw: the same plan before its two newest
 * steps, so exactly one section — `Steps` — reads as changed.
 */
export const PLAN_BASELINE = sectionDigests(
	PLAN_CONTENT.replace(
		"- [ ] Mark changed headings in the section label\n- [ ] Cover a second review in `tui.test.ts`\n",
		"",
	),
);

export const QUESTIONS: Question[] = [
	{
		id: "q1",
		header: "Auth",
		question: "Which authentication should the public API use?",
		options: [
			{ label: "OAuth bearer tokens", description: "Delegated, revocable, and what the gateway already speaks" },
			{ label: "Signed cookies", description: "Simpler for the browser, awkward for machine clients" },
			{ label: "Static API keys", description: "Easiest to issue, hardest to rotate" },
		],
		allowOther: true,
		multiSelect: false,
	},
	{
		id: "q2",
		header: "Scope",
		question: "Which scopes should a token carry?",
		options: [{ label: "read" }, { label: "write" }, { label: "admin" }],
		allowOther: false,
		multiSelect: true,
	},
];

/** The `/watch` screen's watchers: one live file tail with matches, one finished command. */
export const WATCHES: WatchRecord[] = [
	{
		id: "w1",
		label: "errors",
		source: { kind: "file", path: "/home/u/repo/logs/server.log" },
		pattern: "(error|fail)",
		exclude: ["noise"],
		caseSensitive: false,
		wake: false,
		fromStart: false,
		status: "running",
		startedAt: now - 12 * 60_000,
		linesRead: 1834,
		matchCount: 3,
		lastMatchAt: now - 40_000,
	},
	{
		id: "w2",
		label: "build",
		source: { kind: "command", command: "bun run build", cwd: "/home/u/repo" },
		pattern: "error",
		exclude: [],
		caseSensitive: true,
		wake: true,
		fromStart: true,
		status: "exited",
		startedAt: now - 26 * 60_000,
		endedAt: now - 24 * 60_000,
		linesRead: 412,
		matchCount: 0,
		exitCode: 0,
		signal: null,
	},
];

/** Notes the `/memory` picker lists, project scope first. */
export const MEMORY_ENTRIES: MemoryEntries = {
	project: [
		"Run bun run check before every commit",
		"Worktrees live in .pi/worktrees; one per task",
		"Stage explicit paths; never git add -A",
	],
	global: ["Prefer rg over grep for searches", "Ask before publishing a release"],
};

/**
 * The picker's store double: reads the fixture and refuses every write, so a
 * capture can never add, move, or forget a note in the real store.
 */
export const MEMORY_CALLBACKS: MemoryPickerCallbacks = {
	entries: () => MEMORY_ENTRIES,
	trusted: () => true,
	refresh: () => false,
	add: async () => ({ changed: false }),
	update: async () => false,
	forget: async () => false,
	merge: async () => false,
	move: async () => ({ moved: false }),
};

/**
 * The dialogue screens take a TUI for their inline `Editor`. A capture sends no
 * keys and the editor is never shown in list mode, so the two members an editor
 * reads on construction are the whole guarantee this double makes.
 */
export const SCREEN_TUI = { requestRender: noop, terminal: { rows: 40, columns: 120 } } as unknown as TUI;

/** A stored account and an open bridge serving three peers, one of them mid-turn. */
export const WECHAT_ACCOUNT: BotCredentials = {
	botToken: "token",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "bot-id",
	baseUrl: "https://ilink.example.invalid",
	botAgent: "pi",
	createdAt: now - 9 * 24 * 60 * 60_000,
};
export const WECHAT_BRIDGE: BridgeStatus = {
	open: true,
	expired: false,
	paused: false,
	running: true,
	owner: "owner@im.wechat",
	peerCount: 3,
	queued: 2,
	peerStates: [
		{ peer: "alice@im.wechat", state: { status: "running", queued: 0, runningMs: 48_000 } },
		{ peer: "bob@im.wechat", state: { status: "queued", queued: 2 } },
		{ peer: "carol@im.wechat", state: { status: "idle", queued: 0 } },
	],
	refused: 1,
	refusedPeers: ["stranger@im.wechat"],
	mediaDropped: 0,
	promptPending: true,
	prompt: {
		peer: "alice@im.wechat",
		kind: "select",
		title: "Which migration should run first?",
		startedAt: now - 90_000,
	},
	startedAt: now - 3 * 60 * 60_000,
	lastPollAt: now - 2_000,
};
export const WECHAT_VIEW = statusView(WECHAT_ACCOUNT, WECHAT_BRIDGE, now);

/**
 * The extension list the `/bytefly` panel shows: this package, half of it
 * enabled. `bytefly` itself is absent, as it is in the product: the picker drops
 * the host's own entrypoint, and its report lands in the `Not resolved` group.
 */
export const PANEL_CWD = "/home/u/repo";
export const PANEL_AGENT_DIR = "/home/u/.pi/agent";
export const PANEL_ITEMS: ResourceItem[] = [
	packageExtension("plan", true),
	packageExtension("subagent", true),
	packageExtension("worktree", true),
	packageExtension("todo", true),
	packageExtension("job", true),
	packageExtension("memory", true),
	packageExtension("file-read", true),
	packageExtension("web-access", false),
	packageExtension("wechat", false),
];
/** Health for two extensions: one missing a hard prerequisite, one clean. */
export const PANEL_REPORTS: ExtensionReport[] = [
	makeReport("worktree", [
		makeFinding(
			"git",
			"missing",
			"not found on PATH — worktree isolation",
			"install git and make sure it is on PATH (https://git-scm.com/downloads).",
		),
	]),
	makeReport("bytefly", [makeFinding("npm", "ok", "Latest published version 0.13.1")]),
];
/**
 * The panel needs a settings surface even on its Extensions section. These rows
 * are never rendered here, and every write is refused, so nothing reaches
 * `bytefly.json` or `settings.json`.
 */
export const PANEL_SETTINGS: SettingsSurface = {
	views: () => [],
	change: async () => {},
	setValue: async () => false,
	reset: async () => false,
	sectionDocument: () => undefined,
	isDirty: () => false,
};

/** The Settings section's snapshot: a few stored values over the real catalogue. */
const PANEL_SETTINGS_SNAPSHOT: SettingsSnapshot = {
	app: { theme: "bytefly-dark" } as Settings,
	global: {
		notify: { enabled: true, method: "osascript" },
		price: { currency: { code: "CNY", decimals: 2 }, budget: 5 },
		job: { wakeOnFinish: true },
	},
	project: {},
	themes: ["system", "bytefly-dark", "bytefly-light"],
};

/**
 * The Settings section as the capture draws it: the real catalogue over a fixed
 * snapshot. Every write is refused, so a capture cannot reach `bytefly.json` or
 * `settings.json`.
 */
export const PANEL_SETTING_VIEWS: SettingsSurface = {
	views: (scope) => settingViews(PANEL_SETTINGS_SNAPSHOT, scope),
	change: async () => {},
	setValue: async () => false,
	reset: async () => false,
	sectionDocument: (scope, section) =>
		(scope === "global" ? PANEL_SETTINGS_SNAPSHOT.global : PANEL_SETTINGS_SNAPSHOT.project)[section],
	isDirty: () => false,
};

/** One capturable screen: the asset stem, window title, and ANSI renderer. */
