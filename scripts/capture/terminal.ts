/**
 * Capture a Terminal.app window as a PNG (dev tooling).
 *
 * The macOS half of `screenshots.ts`: it opens a Terminal window running the
 * render CLI, waits for the frame to replace the shell's echo, captures the
 * window with `screencapture`, and crops Terminal's title bar off — whose last
 * segment is the capture command's own argv, which no profile switch covers.
 * The `chrome` hero is the same machinery around the fixture's whole window,
 * header and footer included.
 *
 * The frames themselves stay in `screenshots.ts`; this module takes the screen
 * it is given, so `render <name>` keeps working on any OS.
 */

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pollUntil, sleep } from "../poll.ts";
import { repo } from "../theme.ts";
import { WINDOW_BOUNDS } from "../screens/fixtures/index.ts";
import { frameFingerprint, frameLines, recordFrame } from "../screens/frames.ts";
import type { Screen } from "../screens/index.ts";

/** A temporary Terminal profile that matches the theme's canvas, deleted after. */
const PROFILE = "PiScreenshot";
/**
 * Terminal's window title bar, in points. The capture drops it: its last
 * segment is the foreground process's argv, which no profile title switch
 * covers and which carries this machine's paths and environment.
 */
const TITLE_BAR_POINTS = 28;

function osascript(script: string): string {
	return execFileSync("osascript", ["-e", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Create the temporary Terminal profile, unless it is already present. */
export function createProfile(): void {
	osascript(`tell application "Terminal"
		if (name of every settings set) contains "${PROFILE}" then delete settings set "${PROFILE}"
		make new settings set with properties {name:"${PROFILE}", font name:"Menlo-Regular", font size:13, background color:{3341, 4369, 5911}, normal text color:{51657, 53713, 55769}, cursor color:{51657, 53713, 55769}, title displays device name:false, title displays shell path:false, title displays window size:false, title displays settings name:false, title displays custom title:true}
	end tell`);
}

/** Remove the temporary profile; ignore a window that still holds it. */
export function deleteProfile(): void {
	osascript(`tell application "Terminal"
		if (name of every settings set) contains "${PROFILE}" then delete settings set "${PROFILE}"
	end tell`);
}

/** Open one Terminal window running the render. */
function openWindow(name: string, ready: string, screen: Screen): void {
	const bounds = screen.bounds ?? WINDOW_BOUNDS;
	const size = screen.size ? ` --width ${screen.size.width} --rows ${screen.size.rows}` : "";
	const command = `cd ${shellQuote(repo)} && ${shellQuote(process.execPath)} ${shellQuote(join(repo, "scripts", "screenshots.ts"))} render ${name}${size} --hold --ready ${shellQuote(ready)}`;
	// The bounds are set before the render starts: the frame is drawn to the
	// terminal's own columns and rows, so a window resized after it would clip or
	// wrap a frame that had already measured the old geometry.
	const script = `tell application "Terminal"
		activate
		set w to do script ""
		set current settings of w to settings set "${PROFILE}"
		set bounds of front window to {${bounds.left}, ${bounds.top}, ${bounds.right}, ${bounds.bottom}}
		do script ${JSON.stringify(command)} in w
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

/** A window's screen rectangle, in points. */
interface WindowBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** Read a window's bounds from Terminal, or throw rather than capture a guess. */
function windowBounds(id: number): WindowBounds {
	const raw = osascript(`tell application "Terminal" to get bounds of window id ${id}`);
	const parts = raw.split(",").map((value) => Number.parseInt(value.trim(), 10));
	const [left, top, right, bottom] = parts;
	if (parts.length !== 4 || left === undefined || top === undefined || right === undefined || bottom === undefined) {
		throw new Error(`Could not read the bounds of Terminal window ${id}: ${raw}`);
	}
	return { left, top, right, bottom };
}

/**
 * Capture a window by id, then drop its title bar.
 *
 * `screencapture -l` is the reliable capture — it reads the window's own
 * surface, so a window behind another one still comes out right — but it
 * includes the title bar, whose last segment is the foreground process's argv.
 * No Terminal profile switch suppresses that segment, and it repeats the capture
 * command's path in every image, so the strip is cut off afterwards.
 */
async function captureWindow(id: number, out: string): Promise<void> {
	const bounds = windowBounds(id);
	const width = bounds.right - bounds.left;
	if (width <= 0) throw new Error(`Terminal window ${id} has no width`);
	const full = join(tmpdir(), `pi-screenshot-window-${id}.png`);
	let lastError: unknown;
	try {
		for (let attempt = 0; attempt < 6; attempt++) {
			try {
				execFileSync("screencapture", ["-l", String(id), "-o", "-x", full], { stdio: ["ignore", "ignore", "pipe"] });
				cropTitleBar(full, out, width);
				return;
			} catch (error) {
				lastError = error;
				await sleep(300);
			}
		}
	} finally {
		rmSync(full, { force: true });
	}
	throw lastError;
}

/** Cut Terminal's title bar off a window capture into `out`. */
function cropTitleBar(source: string, out: string, windowWidth: number): void {
	execFileSync(
		"osascript",
		[
			"-l",
			"JavaScript",
			join(import.meta.dir, "crop-title-bar.js"),
			source,
			out,
			String(windowWidth),
			String(TITLE_BAR_POINTS),
		],
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
}

export async function captureScreen(name: string, screen: Screen): Promise<void> {
	const ready = join(tmpdir(), `pi-screenshot-${name}.ready`);
	rmSync(ready, { force: true });
	openWindow(name, ready, screen);
	let id: number | undefined;
	try {
		// Capture only once the frame has replaced the shell's command echo.
		await waitForFile(ready, 15_000);
		id = await waitForWindow(screen.title, 5_000);
		const out = join(repo, "assets", "screens", `${screen.asset}.png`);
		await captureWindow(id, out);
		// The picture cannot prove what it shows — two captures of one frame differ
		// by antialiasing — so the frame that was on screen is recorded beside it,
		// and a renderer change nobody recaptured fails the test that reads it.
		const size = screen.size;
		if (size) recordFrame(name, frameFingerprint(frameLines(screen, size.width, size.rows)));
		console.log(`assets/screens/${screen.asset}.png`);
	} finally {
		killRender(name);
		await sleep(300);
		if (id !== undefined) closeWindow(id);
		rmSync(ready, { force: true });
	}
}
