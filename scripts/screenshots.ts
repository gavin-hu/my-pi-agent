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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getMarkdownTheme, VERSION } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, Markdown, setKeybindings, Text, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
// `loadThemeFromPath` and `setThemeInstance` are not on the package root; the
// deep path is a dev-only import that keeps the capture on the shipped theme
// JSON and render path.
import {
	loadThemeFromPath,
	setThemeInstance,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { ToolBlock } from "../extensions/bytefly/block/component.ts";
import { DEFAULT_RAIL_GLYPH, railGlyph } from "../extensions/bytefly/chrome.ts";
import { renderLine } from "../extensions/bytefly/footer/render/layout.ts";
import { buildLines } from "../extensions/bytefly/footer/render/lines.ts";
import type { StatusSnapshot } from "../extensions/bytefly/footer/types.ts";
import { ByteflyHeader } from "../extensions/bytefly/header/component.ts";
import { nameplate } from "../extensions/bytefly/message/format.ts";
import { NoticeComponent } from "../extensions/bytefly/notice/component.ts";
import { DEFAULT_HOST_PAD } from "../extensions/bytefly/pad.ts";
import { SeparatorComponent } from "../extensions/bytefly/separator/component.ts";
import { JobListComponent } from "../extensions/job/tui.ts";
import type { JobRecord } from "../extensions/job/types.ts";
import { askViaTui } from "../extensions/question/tui.ts";
import type { Question } from "../extensions/question/types.ts";
import { RewindListComponent } from "../extensions/rewind/rewind-tui.ts";
import type { RewindPoint } from "../extensions/rewind/timeline.ts";
import { TodoListComponent } from "../extensions/todo/tui.ts";
import type { Todo } from "../extensions/todo/types.ts";
import type { NoticeDetails } from "../lib/notice.ts";
import { GLYPHS, STATUS_KEYS } from "../lib/tui/glyphs.ts";

const repo = resolve(import.meta.dir, "..");
const theme = loadThemeFromPath(join(repo, "themes", "bytefly-dark.json"), "truecolor");

/** Terminal window size in logical points; the render adapts to its columns. */
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

/** One capturable screen: the asset stem, window title, and ANSI renderer. */
interface Screen {
	asset: string;
	title: string;
	render(width: number, rows: number): string[];
}

const SCREENS: Record<string, Screen> = {
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
				{ logs: () => ({ lines: [] }), kill: noop, clear: noop },
				noop,
				noop,
				() => rows,
			).render(width),
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
	currency: { symbol: "$", decimals: 2 },
	cacheHitRate: 87,
	providerCount: 1,
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
 * Draw the whole chrome as one frame: the header, a short transcript (the user
 * nameplate, a tool block, a notice, and the turn rule), and the two-line
 * footer. Every piece is the shipped component with the shipped theme, so the
 * preview and a real session show the same code.
 */
function renderChrome(width: number): string[] {
	setThemeInstance(theme);
	setKeybindings(new KeybindingsManager({ ...TUI_KEYBINDINGS, ...APP_BINDINGS }));
	// Draw at Pi's default output pad, so the frame has a real session's margins.
	const pad = DEFAULT_HOST_PAD;
	const lines = new ByteflyHeader(
		() => theme,
		() => ({ showVersion: true, halfBlocks: true, pad }),
		VERSION,
	).render(width);

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
	lines.push(...new SeparatorComponent(3, theme, pad).render(width));
	lines.push("");

	for (const line of buildLines(CHROME_SNAPSHOT, theme, "/Users/gavin")) {
		lines.push(renderLine(line, width, theme));
	}
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

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

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
function openWindow(name: string, ready: string): void {
	const command = `cd ${shellQuote(repo)} && ${shellQuote(process.execPath)} ${shellQuote(join(repo, "scripts", "screenshots.ts"))} render ${name} --hold --ready ${shellQuote(ready)}`;
	const script = `tell application "Terminal"
		activate
		set w to do script ""
		set current settings of w to settings set "${PROFILE}"
		do script ${JSON.stringify(command)} in w
		set bounds of front window to {${WINDOW_BOUNDS.left}, ${WINDOW_BOUNDS.top}, ${WINDOW_BOUNDS.right}, ${WINDOW_BOUNDS.bottom}}
	end tell`;
	osascript(script);
}

/**
 * Poll for the window whose title the render set, so a restored or unrelated
 * Terminal window is never captured by mistake.
 */
async function waitForWindow(title: string, timeoutMs: number): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const id = Number(
			osascript(`tell application "Terminal"
				repeat with w in windows
					if (name of w) contains ${JSON.stringify(title)} then return id of w
				end repeat
				return 0
			end tell`),
		);
		if (id > 0) return id;
		await sleep(150);
	}
	throw new Error(`Could not find the window titled ${title}`);
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
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const fresh = windowIds().filter((id) => !before.has(id));
		if (fresh.length > 0) return fresh.at(-1) as number;
		await sleep(100);
	}
	throw new Error("Timed out waiting for a new Terminal window");
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
	const deadline = Date.now() + timeoutMs;
	while (!existsSync(path)) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`);
		await sleep(100);
	}
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
 * `--no-themes` avoids a collision with an installed copy, and the worktree env
 * is cleared so no banner line is printed.
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
		`cd ${shellQuote(demo)} && unset PI_WORKTREE_ROOT PI_WORKTREE_BRANCH PI_WORKTREE_MAIN; ` +
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
	openWindow(name, ready);
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
const CHROME_SCREEN: Screen = {
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
