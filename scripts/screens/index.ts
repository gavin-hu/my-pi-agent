/**
 * The frames the docs screenshots are drawn around (dev tooling).
 *
 * One entry per screen: an asset stem, a window title, and a renderer that builds
 * the real component around a fixture, so a capture shows the product rather than
 * a mock and a test can render every frame without a window. The capture itself
 * lives in `../capture/`, and the command that drives both is `../screenshots.ts`.
 */

import { CompactionSummaryMessageComponent, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { PanelComponent } from "../../extensions/bytefly/panel/tui.ts";
import { createPickerRuntime } from "../../extensions/bytefly/picker/runtime.ts";
import { JobListComponent } from "../../extensions/job/view/jobs-screen.ts";
import { MemoryPickerComponent } from "../../extensions/memory/view/memory-picker.ts";
import { PlanViewComponent } from "../../extensions/plan/tui.ts";
import { askViaTui } from "../../extensions/question/view/question-screen.ts";
import { CheckResultComponent } from "../../extensions/check/view/check-screens.ts";
import { ContextComponent } from "../../extensions/context/view/context-report.ts";
import { AgentsBoardComponent } from "../../extensions/subagent/view/agents-board.ts";
import { ReviewListComponent } from "../../extensions/rewind/view/review-tui.ts";
import { RewindListComponent } from "../../extensions/rewind/view/rewind-tui.ts";
import { TodoListComponent } from "../../extensions/todo/view/todo-screen.ts";
import { WatchListComponent } from "../../extensions/watch/view/watch-screen.ts";
import { SessionListComponent } from "../../extensions/session-bus/view/session-list.ts";
import { WorktreeListComponent } from "../../extensions/worktree/screen.ts";
import { StatusScreenComponent } from "../../extensions/wechat/view/status-screen.ts";
import { pageColors, repo, setThemeInstance, theme } from "../theme.ts";
import { frameLines } from "./frames.ts";
import { makeDiscovery, makeStore } from "../../test/helpers/fixtures/picker.ts";
import {
	AGENT_RUNS,
	BUS_BOARD,
	CHECK_RESULT,
	CONTEXT_REPORT,
	JOBS,
	MEMORY_CALLBACKS,
	PANEL_AGENT_DIR,
	PANEL_CWD,
	PANEL_ITEMS,
	PANEL_REPORTS,
	PANEL_SETTING_VIEWS,
	PLAN,
	PLAN_BASELINE,
	QUESTIONS,
	REVIEW_ENTRIES,
	REWIND_POINTS,
	SCREEN_TUI,
	WINDOW_BOUNDS,
	noop,
	now,
	TODOS,
	WATCHES,
	WECHAT_VIEW,
	WORKTREE_SNAPSHOT,
	focusRow,
} from "./fixtures/index.ts";
import { renderHeroFrame, renderTranscriptFrame } from "./whole-window.ts";

export interface Screen {
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
		bounds: { left: 80, top: 80, right: 920, bottom: 333 },
		size: { width: 100, rows: 12 },
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
		render: (width, rows) => renderTranscriptFrame(width, rows),
	},
	todo: {
		asset: "todo",
		title: "π - my-pi-agent · /todos",
		bounds: { left: 80, top: 80, right: 920, bottom: 350 },
		size: { width: 100, rows: 13 },
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
		// checklist under the fixture's Goal/Context/Approach/Visual sections; the
		// frame size is fixed so the capture never depends on the resize.
		bounds: { left: 80, top: 80, right: 1080, bottom: 903 },
		size: { width: 120, rows: 44 },
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
		// The frame is its header, summary, five prompts, the detail line and the hint:
		// 13 rows, so the window is sized to it rather than leaving a third of the
		// poster empty below the closing rule.
		bounds: { left: 80, top: 80, right: 920, bottom: 350 },
		size: { width: 100, rows: 13 },
		render: (width, rows) =>
			new RewindListComponent({
				points: REWIND_POINTS,
				theme,
				onClose: noop,
				requestRender: noop,
				viewportRows: () => rows,
			}).render(width),
	},
	agents: {
		asset: "agents",
		title: "π - my-pi-agent · /agents",
		bounds: { left: 80, top: 80, right: 920, bottom: 281 },
		size: { width: 100, rows: 9 },
		render: (width, rows) =>
			new AgentsBoardComponent({
				runs: () => AGENT_RUNS,
				theme,
				now: () => now,
				onCollect: noop,
				onCancel: noop,
				onClose: noop,
				requestRender: noop,
				viewportRows: () => rows,
			}).render(width),
	},
	context: {
		asset: "context",
		title: "π - my-pi-agent · /context",
		bounds: { left: 80, top: 80, right: 920, bottom: 640 },
		size: { width: 100, rows: 30 },
		render: (width, rows) =>
			new ContextComponent({
				theme,
				report: CONTEXT_REPORT,
				read: () => CONTEXT_REPORT,
				isIdle: () => true,
				compact: noop,
				close: noop,
				requestRender: noop,
				viewportRowsSource: () => rows,
			}).render(width),
	},
	check: {
		asset: "check",
		title: "π - my-pi-agent · /check",
		bounds: { left: 80, top: 80, right: 920, bottom: 315 },
		size: { width: 100, rows: 11 },
		render: (width, rows) =>
			new CheckResultComponent({
				result: CHECK_RESULT,
				cwd: repo,
				theme,
				onRerun: noop,
				onClose: noop,
				requestRender: noop,
				viewportRows: () => rows,
			}).render(width),
	},
	"check-detail": {
		asset: "check-detail",
		title: "π - my-pi-agent · /check · failure",
		// Tall enough for the whole excerpt: the target line sits in the middle.
		bounds: { left: 80, top: 80, right: 920, bottom: 385 },
		size: { width: 100, rows: 15 },
		render: (width, rows) => {
			const component = new CheckResultComponent({
				result: CHECK_RESULT,
				cwd: repo,
				theme,
				onRerun: noop,
				onClose: noop,
				requestRender: noop,
				viewportRows: () => rows,
			});
			// Enter on the focused failure opens its source excerpt.
			component.handleInput("\r");
			return component.render(width);
		},
	},
	review: {
		asset: "review",
		title: "π - my-pi-agent · /review",
		bounds: { left: 80, top: 80, right: 920, bottom: 350 },
		size: { width: 100, rows: 13 },
		render: (width, rows) =>
			new ReviewListComponent({
				entries: REVIEW_ENTRIES,
				prompt: "Refresh the README screenshots",
				theme,
				initialSelected: ["extensions/rewind/commands/review.ts", "extensions/rewind/commands/commands.ts"],
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
	session: {
		asset: "session",
		title: "π - my-pi-agent · /sessions",
		bounds: { left: 80, top: 80, right: 1000, bottom: 350 },
		size: { width: 100, rows: 13 },
		render: (width, rows) =>
			new SessionListComponent({
				board: BUS_BOARD,
				theme,
				callbacks: { toggleWatch: async () => "Inbox watch off.", releaseClaim: async () => "Released." },
				onClose: noop,
				requestRender: noop,
				now: () => now,
				viewportRowsSource: () => rows,
			}).render(width),
	},
	worktree: {
		asset: "worktree",
		title: "π - my-pi-agent · /worktree",
		bounds: { left: 80, top: 80, right: 920, bottom: 400 },
		size: { width: 100, rows: 16 },
		render: (width, rows) =>
			new WorktreeListComponent({
				snapshot: WORKTREE_SNAPSHOT,
				theme,
				requestRender: noop,
				onDone: noop,
				reload: async () => WORKTREE_SNAPSHOT,
				prune: async () => "Pruned 1 worktree",
				readOnly: false,
				viewportRowsSource: () => rows,
			}).render(width),
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
		// The frame pads its body to the tallest section, so the window is exactly
		// the frame: six rows of chrome plus sixteen body rows.
		bounds: { left: 80, top: 80, right: 1080, bottom: 520 },
		size: { width: 120, rows: 22 },
		render: (width, rows) => {
			// A fresh runtime over a fake discovery per render: no probe, no write.
			const { discovery } = makeDiscovery({ extensions: PANEL_ITEMS, globalStore: makeStore(), trusted: true });
			const runtime = createPickerRuntime({ discovery, cwd: PANEL_CWD, agentDir: PANEL_AGENT_DIR });
			const panel = new PanelComponent({
				runtime,
				reports: () => PANEL_REPORTS,
				// The tab row counts the settings, so the extensions screen reads the
				// real catalogue too; nothing here can write through it.
				settings: PANEL_SETTING_VIEWS,
				skills: () => new Map(),
				theme,
				agentDir: PANEL_AGENT_DIR,
				cwd: PANEL_CWD,
				viewportRows: () => rows,
				requestRender: noop,
				refresh: noop,
				reload: noop,
				onClose: noop,
			});
			// The focused row is the one with a finding: the side pane is the reason
			// the frame has two columns, so the picture has to show it saying something.
			focusRow(panel, "worktree", width);
			return panel.render(width);
		},
	},
	"bytefly-settings": {
		asset: "bytefly-settings",
		title: "π - my-pi-agent · /bytefly settings",
		bounds: { left: 80, top: 80, right: 1080, bottom: 520 },
		size: { width: 120, rows: 22 },
		render: (width, rows) => {
			// The Settings section over the real catalogue: no probe, no write.
			const { discovery } = makeDiscovery({ extensions: PANEL_ITEMS, globalStore: makeStore(), trusted: true });
			const runtime = createPickerRuntime({ discovery, cwd: PANEL_CWD, agentDir: PANEL_AGENT_DIR });
			return new PanelComponent({
				runtime,
				reports: () => PANEL_REPORTS,
				settings: PANEL_SETTING_VIEWS,
				skills: () => new Map(),
				section: "settings",
				theme,
				agentDir: PANEL_AGENT_DIR,
				cwd: PANEL_CWD,
				viewportRows: () => rows,
				requestRender: noop,
				refresh: noop,
				reload: noop,
				onClose: noop,
			}).render(width);
		},
	},
	wechat: {
		asset: "wechat",
		title: "π - my-pi-agent · /wechat",
		bounds: { left: 80, top: 80, right: 920, bottom: 400 },
		// Two peers' prompts can wait at once, so the frame is one row taller.
		size: { width: 100, rows: 17 },
		render: (width) =>
			new StatusScreenComponent({
				theme,
				view: () => WECHAT_VIEW,
				onClose: noop,
				requestRender: noop,
			}).render(width),
	},
	chrome: {
		asset: "chrome",
		title: "π - my-pi-agent · chrome",
		// The bounds give 102x36 cells in the capture profile; the pinned size keeps a
		// hint row from wrapping, and the two spare columns keep the footer off the
		// window edge where the crop can shave it. The rows fill the window: a frame
		// shorter than the window leaves its spare cells at the bottom, where nothing
		// in the picture accounts for them, and the spare rows the frame does draw
		// belong above the rails.
		bounds: { left: 80, top: 80, right: 919, bottom: 744 },
		size: { width: 100, rows: 36 },
		render: (width, rows) => renderHeroFrame(width, rows),
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

/** The ANSI frame for one screen, sized to the live terminal or the overrides. */
export function frame(screen: Screen, width: number, rows: number): string {
	// Drawn through the same clock the record and the test use, so the picture is the
	// frame whose fingerprint `captureScreen` writes beside it.
	const lines = frameLines(screen, width, rows);
	// Reset the terminal palette to the theme, clear, then draw the frame and
	// hide the cursor so the capture has no stray glyph.
	const background = `\u001b]11;${pageColors.background}\u0007\u001b]10;${pageColors.text}\u0007`;
	return `\u001b[2J\u001b[H${background}\u001b]0;${screen.title}\u0007${lines.join("\n")}\u001b[J\u001b[?25l`;
}
