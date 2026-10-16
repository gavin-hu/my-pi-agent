/**
 * Regenerate the terminal screenshots the docs embed.
 *
 * macOS only. Each screen is drawn by its real component with the
 * `bytefly-dark` theme inside a real Terminal.app window, then captured with
 * `screencapture`, so the docs show the actual render instead of a mock.
 *
 *   bun run scripts/screenshots.ts            # every screen into assets/
 *   bun run scripts/screenshots.ts todo job   # only the named screens
 *   bun scripts/screenshots.ts render todo    # print the ANSI frame (any OS)
 *
 * The `render` step reads the live terminal width and height, so a capture
 * always fits its window; it holds the frame when passed `--hold`, which the
 * capture path uses so the shell prompt never overwrites it. To preview on a
 * platform without Terminal.app, run `render <name>` and pipe it to a pager
 * that understands ANSI.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// `loadThemeFromPath` is not on the package root; the deep path is a dev-only
// import that keeps the capture on the shipped theme JSON and render path.
import { loadThemeFromPath } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { JobListComponent } from "../extensions/job/tui.ts";
import type { JobRecord } from "../extensions/job/types.ts";
import { askViaTui } from "../extensions/question/tui.ts";
import type { Question } from "../extensions/question/types.ts";
import { RewindListComponent } from "../extensions/rewind/rewind-tui.ts";
import type { RewindPoint } from "../extensions/rewind/timeline.ts";
import { TodoListComponent } from "../extensions/todo/tui.ts";
import type { Todo } from "../extensions/todo/types.ts";

const repo = resolve(import.meta.dir, "..");
const theme = loadThemeFromPath(join(repo, "themes", "bytefly-dark.json"), "truecolor");

/** Terminal window size in logical points; the render adapts to its columns. */
const WINDOW_BOUNDS = { left: 80, top: 80, right: 880, bottom: 400 };
/** A temporary Terminal profile that matches the theme's canvas, deleted after. */
const PROFILE = "PiScreenshot";
/** Terminal's standard title bar height in logical points, scaled at capture. */
const TITLE_BAR_POINTS = 28;

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

/** The ANSI frame for one screen, sized to the live terminal. */
function frame(screen: Screen): string {
	const width = process.stdout.columns ?? 100;
	const rows = process.stdout.rows ?? 30;
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

/**
 * Crop the title bar off a capture, in place, through CoreGraphics. ImageIO and
 * `sips` cannot crop a single edge; Swift ships with the Xcode command line
 * tools, which `screencapture` already implies on a developer Mac.
 */
function cropTitleBar(path: string): void {
	// The capture is at the display's backing scale, so derive the title bar's
	// pixel height from the PNG width against the window's logical width.
	const imageWidth = readFileSync(path).readUInt32BE(16);
	const logicalWidth = WINDOW_BOUNDS.right - WINDOW_BOUNDS.left;
	const top = Math.max(1, Math.round((TITLE_BAR_POINTS * imageWidth) / logicalWidth));
	const source = `import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
let args = CommandLine.arguments
let url = URL(fileURLWithPath: args[1])
let top = Int(args[2]) ?? 0
let out = URL(fileURLWithPath: args[3])
guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(src, 0, nil),
      let cropped = image.cropping(to: CGRect(x: 0, y: top, width: image.width, height: image.height - top)),
      let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)
else { exit(1) }
CGImageDestinationAddImage(dest, cropped, nil)
guard CGImageDestinationFinalize(dest) else { exit(1) }
`;
	const temp = `${path}.crop.png`;
	try {
		execFileSync("swift", ["-", path, String(top), temp], {
			input: source,
			stdio: ["pipe", "ignore", "inherit"],
		});
		renameSync(temp, path);
	} catch {
		console.error("swift not available; leaving the title bar on the capture");
	}
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
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
		cropTitleBar(out);
		console.log(`assets/${screen.asset}.png`);
	} finally {
		killRender(name);
		await sleep(300);
		if (id !== undefined) closeWindow(id);
		rmSync(ready, { force: true });
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args[0] === "render") {
		const screen = SCREENS[args[1]];
		if (!screen) {
			console.error(`Unknown screen "${args[1]}". Known: ${Object.keys(SCREENS).join(", ")}`);
			process.exit(1);
		}
		process.stdout.write(frame(screen));
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
	const names = args.length > 0 ? args : Object.keys(SCREENS);
	createProfile();
	try {
		for (const name of names) await capture(name);
	} finally {
		deleteProfile();
	}
}

void main();
