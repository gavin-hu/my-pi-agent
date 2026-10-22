/**
 * Capture a Terminal.app window as a PNG (dev tooling).
 *
 * The macOS half of `screenshots.ts`: it opens a Terminal window running the
 * render CLI, waits for the frame to replace the shell's echo, captures the
 * window with `screencapture`, and crops Terminal's title bar off — whose last
 * segment is the capture command's own argv, which no profile switch covers.
 * The `chrome` hero is the same machinery around a real `pi -e .` session.
 *
 * The frames themselves stay in `screenshots.ts`; this module takes the screen
 * it is given, so `render <name>` keeps working on any OS.
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
import { pollUntil, sleep } from "./poll.ts";
import { repo } from "./theme.ts";
import { WINDOW_BOUNDS } from "./screenshot-fixtures/index.ts";
import type { Screen } from "./screenshots.ts";

/** The hero is a real `pi -e .` run, so it gets its own size. */
const CHROME_BOUNDS = { left: 80, top: 80, right: 886, bottom: 673 };
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
			join(repo, "scripts", "crop-title-bar.js"),
			source,
			out,
			String(windowWidth),
			String(TITLE_BAR_POINTS),
		],
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
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
	const done = await pollUntil(() => turnComplete(session) || undefined, { timeoutMs, intervalMs: 250 });
	if (done === undefined) throw new Error("Timed out waiting for the hero turn");
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
export async function captureChrome(): Promise<void> {
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

export async function captureScreen(name: string, screen: Screen): Promise<void> {
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
