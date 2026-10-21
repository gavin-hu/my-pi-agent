/**
 * Regenerate the screenshots the docs embed.
 *
 * macOS only. Each screen is drawn by its real component with the
 * `bytefly-dark` theme inside a real Terminal.app window, and the `chrome` hero
 * is a real `pi -e .` session; both are captured with `screencapture` and cropped
 * to the terminal content, so the docs show the actual surface instead of a mock
 * without repeating this machine's capture command in the title bar.
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
 *
 * The frames and the CLI are here; the fixtures they are drawn around are in
 * `screenshot-fixtures.ts`, and the Terminal.app/AppleScript half is in
 * `terminal-capture.ts`.
 */

import { writeFileSync } from "node:fs";
import { CompactionSummaryMessageComponent, getMarkdownTheme, VERSION } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, Markdown, setKeybindings, Text, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { ToolBlock } from "../extensions/bytefly/block/component.ts";
import { DEFAULT_RAIL_GLYPH, railGlyph } from "../extensions/bytefly/chrome.ts";
import { renderLine } from "../extensions/bytefly/footer/render/layout.ts";
import { buildLines } from "../extensions/bytefly/footer/render/lines.ts";
import type { StatusSnapshot } from "../extensions/bytefly/footer/types.ts";
import { ByteflyHeader } from "../extensions/bytefly/header/component.ts";
import { nameplate } from "../extensions/bytefly/message/format.ts";
import { NoticeComponent } from "../extensions/bytefly/notice/component.ts";
import { DEFAULT_HOST_PAD } from "../extensions/bytefly/pad.ts";
import { PanelComponent } from "../extensions/bytefly/panel/tui.ts";
import { createExtensionsPickerRuntime } from "../extensions/bytefly/picker/runtime.ts";
import { SeparatorComponent } from "../extensions/bytefly/separator/component.ts";
import { JobListComponent } from "../extensions/job/tui.ts";
import { MemoryPickerComponent } from "../extensions/memory/tui.ts";
import { PlanViewComponent } from "../extensions/plan/tui.ts";
import { askViaTui } from "../extensions/question/tui.ts";
import { CheckResultComponent } from "../extensions/check/tui.ts";
import { AgentsBoardComponent } from "../extensions/subagent/background-tui.ts";
import { ReviewListComponent } from "../extensions/rewind/review-tui.ts";
import { RewindListComponent } from "../extensions/rewind/rewind-tui.ts";
import { TodoListComponent } from "../extensions/todo/tui.ts";
import { WatchListComponent } from "../extensions/watch/tui.ts";
import { StatusScreenComponent } from "../extensions/wechat/status-screen.ts";
import type { NoticeDetails } from "../lib/notice.ts";
import { GLYPHS, STATUS_KEYS } from "../lib/tui/glyphs.ts";
import { sleep } from "./poll.ts";
import { repo, setThemeInstance, theme } from "./theme.ts";
import { makeDiscovery, makeStore } from "../test/helpers/fixtures/picker.ts";
import { numberArg } from "./cli.ts";
import {
	AGENT_RUNS,
	CHECK_RESULT,
	JOBS,
	MEMORY_CALLBACKS,
	PANEL_AGENT_DIR,
	PANEL_CWD,
	PANEL_ITEMS,
	PANEL_REPORTS,
	PANEL_SETTING_VIEWS,
	PANEL_SETTINGS,
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
} from "./screenshot-fixtures.ts";
import { captureChrome, captureScreen, createProfile, deleteProfile } from "./terminal-capture.ts";

/** The default Terminal window size in logical points; a screen may ask for its own. */

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
	agents: {
		asset: "agents",
		title: "π - my-pi-agent · /agents",
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
	check: {
		asset: "check",
		title: "π - my-pi-agent · /check",
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
		bounds: { left: 80, top: 80, right: 900, bottom: 500 },
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
	"bytefly-settings": {
		asset: "bytefly-settings",
		title: "π - my-pi-agent · /bytefly settings",
		// A 24-row frame needs the window to be tall enough that printing it does
		// not scroll the header rule off the top.
		bounds: { left: 80, top: 80, right: 1080, bottom: 560 },
		size: { width: 120, rows: 24 },
		render: (width, rows) => {
			// The Settings section over the real catalogue: no probe, no write.
			const { discovery } = makeDiscovery({ global: PANEL_ITEMS, globalStore: makeStore(), trusted: true });
			const runtime = createExtensionsPickerRuntime({ discovery, cwd: PANEL_CWD, agentDir: PANEL_AGENT_DIR });
			return new PanelComponent({
				runtime,
				reports: () => PANEL_REPORTS,
				settings: PANEL_SETTING_VIEWS,
				section: "settings",
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
			if (name === "chrome") {
				await captureChrome();
				continue;
			}
			const screen = SCREENS[name];
			if (!screen) {
				console.error(`Unknown screen "${name}". Known: ${Object.keys(SCREENS).join(", ")}`);
				process.exit(1);
			}
			await captureScreen(name, screen);
		}
	} finally {
		deleteProfile();
	}
}

if (import.meta.main) {
	void main();
}
