/**
 * Regenerate the screenshots the docs embed.
 *
 * macOS only. Each screen is drawn by its real component with the
 * `bytefly-dark` theme inside a real Terminal.app window, and the `chrome` hero
 * is a real `pi -e .` session; both are captured with `screencapture`, so the
 * docs show the actual surface instead of a mock, window title and all.
 *
 *   bun run scripts/screenshots.ts            # every screen plus the hero
 *   bun run scripts/screenshots.ts todo job   # only the named screens
 *   bun scripts/screenshots.ts render todo    # print the ANSI frame (any OS)
 *   bun scripts/screenshots.ts render chrome --width 100   # the whole chrome
 *
 * The `render` step reads the live terminal width and height, so a capture
 * always fits its window; `--width` / `--rows` override them. It holds the frame
 * when passed `--hold`, which the capture path uses so the shell prompt never
 * overwrites it. To preview on a platform without Terminal.app, run
 * `render <name>` and pipe it to a pager that understands ANSI.
 */

import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CompactionSummaryMessageComponent, getMarkdownTheme, VERSION } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, Markdown, setKeybindings, Text, TUI_KEYBINDINGS, type TUI } from "@earendil-works/pi-tui";
import { ToolBlock } from "../extensions/bytefly/block/component.ts";
import { DEFAULT_RAIL_GLYPH, railGlyph } from "../extensions/bytefly/chrome.ts";
import { renderLine } from "../extensions/bytefly/footer/render/layout.ts";
import { buildLines } from "../extensions/bytefly/footer/render/lines.ts";
import type { StatusSnapshot } from "../extensions/bytefly/footer/types.ts";
import { ByteflyHeader } from "../extensions/bytefly/header/component.ts";
import { nameplate } from "../extensions/bytefly/message/format.ts";
import { NoticeComponent } from "../extensions/bytefly/notice/component.ts";
import { DEFAULT_HOST_PAD } from "../extensions/bytefly/pad.ts";
import type { SettingsSurface } from "../extensions/bytefly/panel/settings-runtime.ts";
import { PanelComponent } from "../extensions/bytefly/panel/tui.ts";
import { createExtensionsPickerRuntime } from "../extensions/bytefly/picker/runtime.ts";
import type { ResourceItem } from "../extensions/bytefly/picker/types.ts";
import { SeparatorComponent } from "../extensions/bytefly/separator/component.ts";
import { JobListComponent } from "../extensions/job/tui.ts";
import type { JobRecord } from "../extensions/job/types.ts";
import type { MemoryEntries } from "../extensions/memory/format.ts";
import { MemoryPickerComponent, type MemoryPickerCallbacks } from "../extensions/memory/tui.ts";
import { sectionDigests } from "../extensions/plan/plan-text.ts";
import type { StoredPlan } from "../extensions/plan/plans.ts";
import { PlanViewComponent } from "../extensions/plan/tui.ts";
import { askViaTui } from "../extensions/question/tui.ts";
import type { Question } from "../extensions/question/types.ts";
import { ReviewListComponent } from "../extensions/rewind/review-tui.ts";
import type { ReviewEntry } from "../extensions/rewind/paths.ts";
import { RewindListComponent } from "../extensions/rewind/rewind-tui.ts";
import type { RewindPoint } from "../extensions/rewind/timeline.ts";
import { TodoListComponent } from "../extensions/todo/tui.ts";
import type { Todo } from "../extensions/todo/types.ts";
import { WatchListComponent } from "../extensions/watch/tui.ts";
import type { WatchRecord } from "../extensions/watch/types.ts";
import type { BridgeStatus } from "../extensions/wechat/bridge.ts";
import { StatusScreenComponent, statusView } from "../extensions/wechat/status-screen.ts";
import type { BotCredentials } from "../extensions/wechat/types.ts";
import type { NoticeDetails } from "../lib/notice.ts";
import type { ExtensionReport } from "../lib/requirements.ts";
import { GLYPHS, STATUS_KEYS } from "../lib/tui/glyphs.ts";
import { makeFinding, makeReport } from "../test/helpers/fixtures/doctor.ts";
import { makeDiscovery, makeStore, packageExtension } from "../test/helpers/fixtures/picker.ts";
import { pollUntil, sleep } from "./poll.ts";
import { repo, setThemeInstance, theme } from "./theme.ts";

/** The default Terminal window size in logical points; a screen may ask for its own. */
const WINDOW_BOUNDS = { left: 80, top: 80, right: 880, bottom: 400 };
/** The hero is a real `pi -e .` run, so it gets its own size. */
const CHROME_BOUNDS = { left: 80, top: 80, right: 886, bottom: 673 };
/** A temporary Terminal profile that matches the theme's canvas, deleted after. */
const PROFILE = "PiScreenshot";

const noop = (): void => {};
const now = Date.now();

const TODOS: Todo[] = [
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

const JOBS: JobRecord[] = [
	{
		id: "j1",
		label: "bun test --watch",
		command: "bun test --watch",
		cwd: repo,
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
		cwd: repo,
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
		cwd: repo,
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
		cwd: repo,
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

const REWIND_POINTS: RewindPoint[] = [
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

/** The changed files the review screen shows after a documentation turn. */
const REVIEW_ENTRIES: ReviewEntry[] = [
	{ path: "extensions/rewind/review.ts", change: "modified", added: 42, removed: 3 },
	{ path: "extensions/rewind/review-tui.ts", change: "added", added: 180, removed: 0 },
	{ path: "extensions/rewind/commands.ts", change: "modified", added: 6, removed: 1 },
	{ path: "assets/review.png", change: "added", added: null, removed: null },
];

/** The plan the review screen shows; its `Steps` section changed on this review. */
const PLAN_PATH = "/home/u/repo/.pi/plans/2026-10-18-1430-plan-review-change-marks.md";
const PLAN_CONTENT = [
	"# Plan review: mark the sections that changed",
	"",
	"## Goal",
	"",
	"Show a returning reviewer what changed since the last review, without leaving the plan review screen.",
	"",
	"## Context",
	"",
	"The review screen renders the plan body with Pi's own Markdown component, so headings, lists, and code already match the rest of the application. Two things are still missing for a second review: the notice that a section was revised, and a position readout once the body is taller than the terminal.",
	"",
	"## Approach",
	"",
	"- Persist the per-section digests of the reviewed plan with the approval.",
	"- Diff the new plan against them and mark every heading that changed.",
	"- Draw the scroll gauge from the shared kit, with `n`/`p` section jumps.",
	"",
	"## Steps",
	"",
	"- [x] Store the review baseline alongside the approval",
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
	"`bun test extensions/plan` and the render checks in `screenshots.test.ts`.",
].join("\n");
const PLAN: StoredPlan = {
	path: PLAN_PATH,
	relativePath: ".pi/plans/2026-10-18-1430-plan-review-change-marks.md",
	content: PLAN_CONTENT,
	bytes: Buffer.byteLength(PLAN_CONTENT),
};
/**
 * The digests the previous review saw: the same plan before its two newest
 * steps, so exactly one section — `Steps` — reads as changed.
 */
const PLAN_BASELINE = sectionDigests(
	PLAN_CONTENT.replace(
		"- [ ] Mark changed headings in the section label\n- [ ] Cover a second review in `tui.test.ts`\n",
		"",
	),
);

const QUESTIONS: Question[] = [
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
const WATCHES: WatchRecord[] = [
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
const MEMORY_ENTRIES: MemoryEntries = {
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
const MEMORY_CALLBACKS: MemoryPickerCallbacks = {
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
const SCREEN_TUI = { requestRender: noop, terminal: { rows: 40, columns: 120 } } as unknown as TUI;

/** A stored account and an open bridge serving three peers, one of them mid-turn. */
const WECHAT_ACCOUNT: BotCredentials = {
	botToken: "token",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "bot-id",
	baseUrl: "https://ilink.example.invalid",
	botAgent: "pi",
	createdAt: now - 9 * 24 * 60 * 60_000,
};
const WECHAT_BRIDGE: BridgeStatus = {
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
const WECHAT_VIEW = statusView(WECHAT_ACCOUNT, WECHAT_BRIDGE, now);

/** The extension list the `/bytefly` panel shows: this package, half of it enabled. */
const PANEL_CWD = "/home/u/repo";
const PANEL_AGENT_DIR = "/home/u/.pi/agent";
const PANEL_ITEMS: ResourceItem[] = [
	packageExtension("bytefly", true),
	packageExtension("plan", true),
	packageExtension("subagent", true),
	packageExtension("worktree", true),
	packageExtension("todo", true),
	packageExtension("job", true),
	packageExtension("memory", true),
	packageExtension("document", true),
	packageExtension("web-access", false),
	packageExtension("wechat", false),
];
/** Health for two rows: one degraded by a missing extractor, one clean. */
const PANEL_REPORTS: ExtensionReport[] = [
	makeReport("document", [
		makeFinding("pdftotext", "missing", "PDF text extraction is unavailable", "brew install poppler"),
	]),
	makeReport("bytefly", [makeFinding("npm", "ok", "Latest published version 0.13.1")]),
];
/**
 * The panel needs a settings surface even on its Extensions section. These rows
 * are never rendered here, and every write is refused, so nothing reaches
 * `bytefly.json` or `settings.json`.
 */
const PANEL_SETTINGS: SettingsSurface = {
	views: () => [],
	change: async () => {},
	setValue: async () => false,
	reset: async () => false,
	sectionDocument: () => undefined,
	isDirty: () => false,
};

/** One capturable screen: the asset stem, window title, and ANSI renderer. */
interface Screen {
	asset: string;
	title: string;
	/**
	 * Terminal window bounds in logical points. A screen sets its own when the
	 * default window is too short for its body or one column too narrow.
	 */
	bounds?: typeof WINDOW_BOUNDS;
	/**
	 * Frame size to render instead of the window's live size. Terminal.app has a
	 * minimum window width and snaps a resize to whole cells, so a screen that
	 * budgets rows or wraps a hint row would otherwise capture at whatever size
	 * the window happened to reach.
	 */
	size?: { width: number; rows: number };
	render(width: number, rows: number): string[];
}

export const SCREENS: Record<string, Screen> = {
	compaction: {
		asset: "compaction",
		title: "π - my-pi-agent · /compact",
		render: (width) => {
			setThemeInstance(theme);
			const message = {
				role: "compactionSummary",
				summary: [
					"### Summary",
					"",
					"- Built the retry wrapper in `src/http.ts` with three attempts and exponential backoff.",
					"- Moved the timeout into the wrapper; `src/cli.ts` still imports `run` from `./run.js`.",
					"- `bun run check` fails on the missing `run` export, not on the wrapper.",
					"- Next: add the export, then re-run the check.",
				].join("\n"),
				tokensBefore: 42_817,
				timestamp: 0,
			} as const;
			const component = new CompactionSummaryMessageComponent(message as never, getMarkdownTheme(), 1);
			component.setExpanded(true);
			return component.render(width);
		},
	},
	transcript: {
		asset: "transcript",
		title: "π - my-pi-agent · transcript",
		// A wide, short window: the footer's right column is long enough that the
		// default width could clip it, and the body is short enough that a tall
		// window would leave empty rows under the footer.
		bounds: { left: 80, top: 80, right: 1080, bottom: 483 },
		size: { width: 100, rows: 24 },
		render: (width, rows) => renderTranscript(width, rows),
	},
	todo: {
		asset: "todo",
		title: "π - my-pi-agent · /todos",
		render: (width, rows) =>
			new TodoListComponent(
				() => TODOS,
				theme,
				noop,
				noop,
				() => rows,
			).render(width),
	},
	question: {
		asset: "question",
		title: "π - my-pi-agent · ask_user_question",
		render: renderQuestion,
	},
	job: {
		asset: "job",
		title: "π - my-pi-agent · /jobs",
		render: (width, rows) =>
			new JobListComponent(
				() => JOBS,
				theme,
				{ sessionId: () => "s1", logs: () => ({ lines: [] }), kill: noop, clear: noop },
				noop,
				noop,
				() => rows,
			).render(width),
	},
	plan: {
		asset: "plan",
		title: "π - my-pi-agent · exit_plan_mode",
		// Wide enough for the whole hint row and tall enough to reach the Steps
		// list; the frame size is fixed so the capture never depends on the resize.
		bounds: { left: 80, top: 80, right: 1080, bottom: 740 },
		size: { width: 120, rows: 35 },
		render: (width, rows) => {
			setThemeInstance(theme);
			return new PlanViewComponent({
				plan: PLAN,
				baseline: PLAN_BASELINE,
				theme,
				onClose: noop,
				requestRender: noop,
				viewportRows: () => rows,
			}).render(width);
		},
	},
	rewind: {
		asset: "rewind",
		title: "π - my-pi-agent · /rewind",
		render: (width, rows) =>
			new RewindListComponent({
				points: REWIND_POINTS,
				theme,
				onClose: noop,
				requestRender: noop,
				viewportRows: () => rows,
			}).render(width),
	},
	review: {
		asset: "review",
		title: "π - my-pi-agent · /review",
		render: (width, rows) =>
			new ReviewListComponent({
				entries: REVIEW_ENTRIES,
				prompt: "Refresh the README screenshots",
				theme,
				initialSelected: ["extensions/rewind/review.ts", "extensions/rewind/commands.ts"],
				onClose: noop,
				requestRender: noop,
				viewportRows: () => rows,
			}).render(width),
	},
	watch: {
		asset: "watch",
		title: "π - my-pi-agent · /watch",
		bounds: { left: 80, top: 80, right: 920, bottom: 330 },
		size: { width: 100, rows: 11 },
		render: (width, rows) =>
			new WatchListComponent(
				() => WATCHES,
				theme,
				{ lines: () => undefined, stop: noop, clear: noop },
				noop,
				noop,
				() => rows,
			).render(width),
	},
	memory: {
		asset: "memory",
		title: "π - my-pi-agent · /memory",
		bounds: { left: 80, top: 80, right: 920, bottom: 330 },
		size: { width: 100, rows: 11 },
		render: (width, rows) =>
			new MemoryPickerComponent(SCREEN_TUI, theme, MEMORY_CALLBACKS, noop, noop, () => rows).render(width),
	},
	bytefly: {
		asset: "bytefly",
		title: "π - my-pi-agent · /bytefly",
		bounds: { left: 80, top: 80, right: 1080, bottom: 460 },
		size: { width: 120, rows: 19 },
		render: (width, rows) => {
			// A fresh runtime over a fake discovery per render: no probe, no write.
			const { discovery } = makeDiscovery({ global: PANEL_ITEMS, globalStore: makeStore(), trusted: true });
			const runtime = createExtensionsPickerRuntime({ discovery, cwd: PANEL_CWD, agentDir: PANEL_AGENT_DIR });
			return new PanelComponent({
				runtime,
				reports: () => PANEL_REPORTS,
				settings: PANEL_SETTINGS,
				theme,
				agentDir: PANEL_AGENT_DIR,
				cwd: PANEL_CWD,
				viewportRows: () => rows,
				requestRender: noop,
				refresh: noop,
				onClose: noop,
			}).render(width);
		},
	},
	wechat: {
		asset: "wechat",
		title: "π - my-pi-agent · /wechat",
		bounds: { left: 80, top: 80, right: 920, bottom: 400 },
		size: { width: 100, rows: 16 },
		render: (width) =>
			new StatusScreenComponent({
				theme,
				view: () => WECHAT_VIEW,
				onClose: noop,
				requestRender: noop,
			}).render(width),
	},
};

/** Render the question dialog by capturing the component `ctx.ui.custom` builds. */
function renderQuestion(width: number, rows: number): string[] {
	let component: { render(w: number): string[] } | undefined;
	const tui = { requestRender: noop, terminal: { rows, columns: width } };
	const ctx = {
		ui: {
			custom: (
				factory: (tui: unknown, theme: unknown, keybindings: unknown, done: unknown) => { render(w: number): string[] },
			) =>
				new Promise(() => {
					component = factory(tui, theme, undefined, noop);
				}),
		},
	};
	void askViaTui(ctx as never, QUESTIONS);
	return component ? component.render(width) : [];
}

/** Pi's default app keybindings, so the preview header's help rows resolve. */
const APP_BINDINGS = {
	"app.interrupt": { defaultKeys: "escape", description: "Cancel or abort" },
	"app.clear": { defaultKeys: "ctrl+c", description: "Clear editor" },
	"app.exit": { defaultKeys: "ctrl+d", description: "Exit when editor is empty" },
	"app.suspend": { defaultKeys: "ctrl+z", description: "Suspend to background" },
	"app.tools.expand": { defaultKeys: "ctrl+o", description: "Toggle tool output" },
	"app.thinking.toggle": { defaultKeys: "ctrl+t", description: "Toggle thinking blocks" },
	"app.thinking.cycle": { defaultKeys: "shift+tab", description: "Cycle thinking level" },
	"app.model.cycleForward": { defaultKeys: "ctrl+p", description: "Cycle to next model" },
	"app.model.select": { defaultKeys: "ctrl+l", description: "Open model selector" },
	"app.editor.external": { defaultKeys: "ctrl+g", description: "Open external editor" },
	"app.message.followUp": { defaultKeys: "alt+enter", description: "Queue follow-up message" },
	"app.clipboard.pasteImage": { defaultKeys: "ctrl+v", description: "Paste from clipboard" },
} as const;

/** The preview bar's snapshot, every field populated. */
const CHROME_SNAPSHOT: StatusSnapshot = {
	cwd: "/Users/gavin/repo/my-pi-agent",
	sessionName: null,
	branch: "main",
	statuses: new Map([
		[STATUS_KEYS.planMode, `${GLYPHS.plan} plan`],
		[STATUS_KEYS.worktree, `${GLYPHS.worktree} smoke`],
	]),
	model: { id: "opus-4.5", provider: "anthropic", reasoning: true },
	thinkingLevel: "high",
	context: { tokens: 124000, contextWindow: 200000, percent: 62 },
	usage: { input: 42000, output: 8000, cacheRead: 96000, cacheWrite: 0, cost: 0.31 },
	currency: { code: "USD", decimals: 2 },
	cacheHitRate: 87,
	providerCount: 1,
	// Two delegated runs, priced separately: the parent `usage` above is unchanged.
	delegation: {
		runs: 2,
		usage: { input: 18000, output: 2400, cacheRead: 0, cacheWrite: 0, cost: 0.06 },
	},
};

/** The notice the preview shows: the shape `job`/`watch` post to the transcript. */
const CHROME_NOTICE: NoticeDetails = {
	source: "job",
	title: "2 background jobs finished",
	items: [
		{ label: "j1 build", detail: "exit 0", severity: "ok" },
		{ label: "j2 test", detail: "exit 1", severity: "bad" },
	],
};

/**
 * Draw the transcript body as one frame: the user nameplate, a tool block, a
 * notice, the turn rule, and the two-line footer. No header, so the frame carries
 * no version string; `renderChrome` puts the header above it.
 */
function renderTranscript(width: number, rows?: number): string[] {
	setThemeInstance(theme);
	setKeybindings(new KeybindingsManager({ ...TUI_KEYBINDINGS, ...APP_BINDINGS }));
	// Draw at Pi's default output pad, so the frame has a real session's margins.
	const pad = DEFAULT_HOST_PAD;
	const lines: string[] = [];

	// The transformer sees the Markdown's content width, not the padded frame.
	const plate = nameplate(width - pad * 2);
	if (plate) lines.push(...new Markdown(plate, pad, 0, getMarkdownTheme()).render(width));
	lines.push("", `${" ".repeat(pad)}${theme.fg("text", "Ready when you are.")}`, "");

	// A tool block: the call leads as the headline, the result rails under it.
	lines.push(
		...new ToolBlock(new Text("read src/app.ts", 0, 0), pad, {
			headline: true,
			toolName: "read",
		}).render(width),
	);
	lines.push(
		...new ToolBlock(new Text("const answer = 42;", 0, 0), pad, {
			trimLeading: true,
			rail: railGlyph(theme, "faint", DEFAULT_RAIL_GLYPH),
		}).render(width),
	);
	lines.push("");

	lines.push(...new NoticeComponent(CHROME_NOTICE, theme, pad).render(width));
	lines.push("");
	lines.push(...new SeparatorComponent({ turn: 3, durationMs: 72_000, tools: 7 }, theme, pad).render(width));
	lines.push("");

	const footer = buildLines(CHROME_SNAPSHOT, theme, "/Users/gavin").map((line) => renderLine(line, width, theme));
	// A real session keeps the footer at the bottom of the window, with the
	// transcript growing above it; pad to that shape when the frame has a height.
	if (rows !== undefined) {
		for (let i = 0; i < rows - lines.length - footer.length; i++) lines.push("");
	}
	lines.push(...footer);
	return lines;
}

/** Draw the whole chrome as one frame: the header above the transcript body. */
function renderChrome(width: number): string[] {
	setThemeInstance(theme);
	const lines = new ByteflyHeader(
		() => theme,
		() => ({ showVersion: true, halfBlocks: true, pad: DEFAULT_HOST_PAD }),
		VERSION,
	).render(width);
	lines.push(...renderTranscript(width));
	return lines;
}

/** The ANSI frame for one screen, sized to the live terminal or the overrides. */
function frame(screen: Screen, width: number, rows: number): string {
	const lines = screen.render(width, rows);
	// Reset the terminal palette to the theme, clear, then draw the frame and
	// hide the cursor so the capture has no stray glyph.
	const background = "\u001b]11;#0d1117\u0007\u001b]10;#c9d1d9\u0007";
	return `\u001b[2J\u001b[H${background}\u001b]0;${screen.title}\u0007${lines.join("\n")}\u001b[J\u001b[?25l`;
}

/** Run an AppleScript and return its trimmed stdout. */
function osascript(script: string): string {
	return execFileSync("osascript", ["-e", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Create the temporary Terminal profile, unless it is already present. */
function createProfile(): void {
	osascript(`tell application "Terminal"
		if (name of every settings set) contains "${PROFILE}" then delete settings set "${PROFILE}"
		make new settings set with properties {name:"${PROFILE}", font name:"Menlo-Regular", font size:13, background color:{3341, 4369, 5911}, normal text color:{51657, 53713, 55769}, cursor color:{51657, 53713, 55769}, title displays device name:false, title displays shell path:false, title displays window size:false, title displays settings name:false, title displays custom title:true}
	end tell`);
}

/** Remove the temporary profile; ignore a window that still holds it. */
function deleteProfile(): void {
	osascript(`tell application "Terminal"
		if (name of every settings set) contains "${PROFILE}" then delete settings set "${PROFILE}"
	end tell`);
}

/** Open one Terminal window running the render. */
function openWindow(name: string, ready: string, screen: Screen): void {
	const bounds = screen.bounds ?? WINDOW_BOUNDS;
	const size = screen.size ? ` --width ${screen.size.width} --rows ${screen.size.rows}` : "";
	const command = `cd ${shellQuote(repo)} && ${shellQuote(process.execPath)} ${shellQuote(join(repo, "scripts", "screenshots.ts"))} render ${name}${size} --hold --ready ${shellQuote(ready)}`;
	const script = `tell application "Terminal"
		activate
		set w to do script ""
		set current settings of w to settings set "${PROFILE}"
		do script ${JSON.stringify(command)} in w
		set bounds of front window to {${bounds.left}, ${bounds.top}, ${bounds.right}, ${bounds.bottom}}
	end tell`;
	osascript(script);
}

/**
 * Poll for the window whose title the render set, so a restored or unrelated
 * Terminal window is never captured by mistake.
 */
async function waitForWindow(title: string, timeoutMs: number): Promise<number> {
	const id = await pollUntil(
		() => {
			const found = Number(
				osascript(`tell application "Terminal"
					repeat with w in windows
						if (name of w) contains ${JSON.stringify(title)} then return id of w
					end repeat
					return 0
				end tell`),
			);
			return found > 0 ? found : undefined;
		},
		{ timeoutMs, intervalMs: 150 },
	);
	if (id === undefined) throw new Error(`Could not find the window titled ${title}`);
	return id;
}

function closeWindow(id: number): void {
	try {
		osascript(`tell application "Terminal" to close (first window whose id is ${id})`);
	} catch {
		// The window already closed when its shell exited.
	}
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Window ids Terminal currently has open. */
function windowIds(): number[] {
	const list = osascript('tell application "Terminal" to get id of every window');
	return list
		.split(",")
		.map((id) => Number(id.trim()))
		.filter((id) => Number.isFinite(id));
}

/** Poll for a window id that was not open before, so restores are ignored. */
async function waitForNewWindow(before: Set<number>, timeoutMs: number): Promise<number> {
	const id = await pollUntil(
		() =>
			windowIds()
				.filter((candidate) => !before.has(candidate))
				.at(-1),
		{
			timeoutMs,
			intervalMs: 100,
		},
	);
	if (id === undefined) throw new Error("Timed out waiting for a new Terminal window");
	return id;
}

/** Stop the held render for `name`, so its Terminal window is no longer busy. */
function killRender(name: string): void {
	try {
		execFileSync("pkill", ["-f", `screenshots.ts render ${name} --hold`], { stdio: "ignore" });
	} catch {
		// Already gone, or pkill is unavailable; the close below still runs.
	}
}

/** Wait for the render to report its first frame, up to `timeoutMs`. */
async function waitForFile(path: string, timeoutMs: number): Promise<void> {
	const reached = await pollUntil(() => existsSync(path) || undefined, { timeoutMs, intervalMs: 100 });
	if (reached === undefined) throw new Error(`Timed out waiting for ${path}`);
}

/**
 * Capture a window by id, retrying while Terminal finishes putting it on
 * screen: `screencapture -l` fails on a window the compositor has not mapped.
 */
async function captureWindow(id: number, out: string): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 6; attempt++) {
		try {
			execFileSync("screencapture", ["-l", String(id), "-o", "-x", out], { stdio: ["ignore", "ignore", "pipe"] });
			return;
		} catch (error) {
			lastError = error;
			await sleep(300);
		}
	}
	throw lastError;
}

/** Whether a session file has an assistant message that ended the turn. */
function turnComplete(session: string): boolean {
	if (!existsSync(session)) return false;
	try {
		for (const line of readFileSync(session, "utf8").split("\n")) {
			if (!line.trim()) continue;
			const entry = JSON.parse(line) as { message?: { role?: string; stopReason?: string } };
			const message = entry.message;
			if (message?.role !== "assistant") continue;
			if (message.stopReason && message.stopReason !== "toolUse") return true;
		}
	} catch {
		// The file is mid-write; try again on the next poll.
	}
	return false;
}

/** Wait for the seeded `pi` turn to finish, then let the TUI settle. */
async function waitForTurn(session: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (turnComplete(session)) return;
		await sleep(250);
	}
	throw new Error("Timed out waiting for the hero turn");
}

/**
 * Capture the hero: a real `pi -e .` session in a Terminal window, so the bytefly
 * chrome is the shipped code rather than a mock. `-ne` isolates the package from
 * anything else installed, `--offline` drops the startup update check (so an
 * outdated local `pi` cannot put an "Update Available" box in the hero),
 * `--no-themes` avoids a collision with an installed copy, the worktree env is
 * cleared so no banner line is printed, and the hero runs on its own agent dir so
 * no line about the capturing machine's live state can reach the frame.
 */
async function captureChrome(): Promise<void> {
	const session = join(tmpdir(), "pi-screenshot-chrome.jsonl");
	rmSync(session, { force: true });
	const pi = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
	// A throwaway git repo under the home directory, so the bar shows a short,
	// plausible path and a branch instead of this checkout's own worktree path.
	// The name is fixed when it is free; a stray existing directory of that name
	// is left alone and a fresh temp one is used instead.
	const named = join(homedir(), "retry-policy");
	const demo = existsSync(named) ? mkdtempSync(join(homedir(), "pi-hero-")) : named;
	// The hero's own agent dir, seeded with the live one's top-level JSON: auth,
	// model definitions, and bytefly's config, so the turn still runs and the
	// chrome is the configured one. No directory is copied — a live WeChat bridge
	// would otherwise put "another session is already polling" in the frame, and
	// no session history belongs in a screenshot.
	const agentDir = mkdtempSync(join(tmpdir(), "pi-hero-agent-"));
	const liveAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	for (const entry of readdirSync(liveAgentDir)) {
		const from = join(liveAgentDir, entry);
		if (entry.endsWith(".json") && statSync(from).isFile()) copyFileSync(from, join(agentDir, entry));
	}
	// Pi keeps the helper binaries it downloads (`fd`, `rg`) in `<agentDir>/bin` and
	// warns when they are missing, so the hero gets that directory by reference.
	// It is a link, not a copy: unlinking it in the cleanup below leaves the live
	// one alone.
	const liveBin = join(liveAgentDir, "bin");
	const agentBin = join(agentDir, "bin");
	if (existsSync(liveBin)) symlinkSync(liveBin, agentBin, "dir");
	execFileSync("git", ["init", "-q", "-b", "feature/retry-policy", demo]);
	writeFileSync(join(demo, "retry.ts"), "export const retries = 3;\n");
	execFileSync("git", ["-C", demo, "add", "-A"]);
	execFileSync("git", [
		"-C",
		demo,
		"-c",
		"user.name=Hero",
		"-c",
		"user.email=hero@example.com",
		"commit",
		"-qm",
		"Add the retry budget",
	]);
	const command =
		`cd ${shellQuote(demo)} && export PI_CODING_AGENT_DIR=${shellQuote(agentDir)} && ` +
		"unset PI_WORKTREE_ROOT PI_WORKTREE_BRANCH PI_WORKTREE_MAIN; " +
		`for n in \${(k)parameters}; do case \${n:u} in *KEY*|*TOKEN*|*SECRET*|*PASSWORD*) unset $n ;; esac; done; ` +
		`${shellQuote(pi)} -ne --offline -e ${shellQuote(repo)} --no-themes ` +
		`--theme ${shellQuote(join(repo, "themes", "bytefly-dark.json"))} --use-theme bytefly-dark ` +
		`--thinking off -n my-pi-agent 'how are you today?' --session ${shellQuote(session)} -a`;
	const before = new Set(windowIds());
	osascript('tell application "Terminal" to do script ""');
	const id = await waitForNewWindow(before, 5_000);
	osascript(`tell application "Terminal"
		set w to window id ${id}
		set current settings of tab 1 of w to settings set "${PROFILE}"
		set bounds of w to {${CHROME_BOUNDS.left}, ${CHROME_BOUNDS.top}, ${CHROME_BOUNDS.right}, ${CHROME_BOUNDS.bottom}}
		do script ${JSON.stringify(command)} in w
	end tell`);
	try {
		await waitForTurn(session, 120_000);
		// Let the turn rule and footer settle, and bring the window forward so its
		// traffic lights are drawn active, before the capture.
		await sleep(1200);
		osascript(`tell application "Terminal"
			activate
			set index of window id ${id} to 1
		end tell`);
		await sleep(400);
		const out = join(repo, "assets", "chrome.png");
		await captureWindow(id, out);
		console.log("assets/chrome.png");
	} finally {
		try {
			execFileSync("pkill", ["-f", session], { stdio: "ignore" });
		} catch {
			// Already gone.
		}
		await sleep(300);
		closeWindow(id);
		rmSync(session, { force: true });
		rmSync(demo, { recursive: true, force: true });
		rmSync(agentBin, { force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
}

async function capture(name: string): Promise<void> {
	const screen = SCREENS[name];
	if (!screen) {
		console.error(`Unknown screen "${name}". Known: ${Object.keys(SCREENS).join(", ")}`);
		process.exit(1);
	}
	const ready = join(tmpdir(), `pi-screenshot-${name}.ready`);
	rmSync(ready, { force: true });
	openWindow(name, ready, screen);
	let id: number | undefined;
	try {
		// Capture only once the frame has replaced the shell's command echo.
		await waitForFile(ready, 15_000);
		id = await waitForWindow(screen.title, 5_000);
		const out = join(repo, "assets", `${screen.asset}.png`);
		await captureWindow(id, out);
		console.log(`assets/${screen.asset}.png`);
	} finally {
		killRender(name);
		await sleep(300);
		if (id !== undefined) closeWindow(id);
		rmSync(ready, { force: true });
	}
}

/** A numeric `--flag value` argument, or undefined when absent or unusable. */
function numberArg(args: string[], flag: string): number | undefined {
	const index = args.indexOf(flag);
	if (index < 0) return undefined;
	const value = Number.parseInt(args[index + 1] ?? "", 10);
	return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The chrome preview: one frame of the whole chrome, drawn by the shipped
 * components with the shipped theme. `captureChrome()` is the authoritative
 * shot — a real `pi -e .` session — but this frame is what makes the design
 * reviewable on any OS and at any width.
 */
export const CHROME_SCREEN: Screen = {
	asset: "chrome",
	title: "π - my-pi-agent · chrome",
	render: (width) => renderChrome(width),
};

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args[0] === "render") {
		const width = numberArg(args, "--width") ?? process.stdout.columns ?? 100;
		const rows = numberArg(args, "--rows") ?? process.stdout.rows ?? 30;
		const screen = args[1] === "chrome" ? CHROME_SCREEN : SCREENS[args[1]];
		if (!screen) {
			console.error(`Unknown screen "${args[1]}". Known: chrome, ${Object.keys(SCREENS).join(", ")}`);
			process.exit(1);
		}
		process.stdout.write(frame(screen, width, rows));
		const readyIndex = args.indexOf("--ready");
		const ready = readyIndex >= 0 ? args[readyIndex + 1] : undefined;
		if (ready) writeFileSync(ready, "");
		if (args.includes("--hold")) {
			// A bare pending promise does not keep the event loop alive, so hold the
			// frame with a long timer until the capture kills the process.
			process.on("SIGTERM", () => process.exit(0));
			process.on("SIGINT", () => process.exit(0));
			await sleep(24 * 60 * 60 * 1000);
		}
		return;
	}
	if (process.platform !== "darwin") {
		console.error("Capture needs macOS (Terminal.app + screencapture). Use `render <name>` to preview.");
		process.exit(1);
	}
	const names = args.length > 0 ? args : [...Object.keys(SCREENS), "chrome"];
	createProfile();
	try {
		for (const name of names) {
			if (name === "chrome") await captureChrome();
			else await capture(name);
		}
	} finally {
		deleteProfile();
	}
}

if (import.meta.main) {
	void main();
}
