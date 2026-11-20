/**
 * Opening a page in the default browser, cross-platform — and saying when it did not.
 *
 * Shared by `file-browse` (`/browse`), `board` (`/board`), and `plan` (the browser
 * review and its read-only view). `browserCommand` is pure, so the command each
 * platform runs and the URL it carries are asserted without a process.
 * `openPageInBrowser` answers the two decisions a caller makes — the project's
 * switch, and whether the turn is answered from outside the terminal — and hands a
 * launcher failure back through `onFailure`.
 *
 * Opening is still best-effort: the URL is printed either way. What is not
 * best-effort is the silence. A launcher that cannot start reports an `'error'`
 * event asynchronously, and one that starts and refuses reports a non-zero exit;
 * neither reaches a `try` block, so both are listened for here, once.
 */

import { spawn } from "node:child_process";
import { messageOf } from "./errors.ts";

/** A command and its arguments, ready to spawn without a shell. */
export interface BrowserCommand {
	command: string;
	args: string[];
}

/**
 * The command that opens `url` on `platform`.
 *
 * `$BROWSER` wins everywhere: a person who sets it means it. Windows hands the URL to
 * `explorer` rather than `cmd /c start`, because nothing here runs through a shell and
 * `cmd` would split a URL at its `&` — `/board team` adds one. WSL gets its own opener:
 * `xdg-open` there usually exists and opens nothing.
 */
export function browserCommand(
	url: string,
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): BrowserCommand {
	const named = env.BROWSER?.trim();
	if (named) {
		const [command, ...args] = named.split(/\s+/);
		if (command) return { command, args: [...args, url] };
	}
	if (platform === "win32") return { command: "explorer", args: [url] };
	if (platform === "darwin") return { command: "open", args: [url] };
	if (env.WSL_DISTRO_NAME) return { command: "wslview", args: [url] };
	return { command: "xdg-open", args: [url] };
}

/** What a launched child reports: a start failure, or how it ended. */
export interface LauncherChild {
	on(event: "error", listener: (error: Error) => void): unknown;
	on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

/** A launcher seam; the default spawns the command detached so the tab outlives the session. */
export type Launch = (command: string, args: string[]) => LauncherChild | undefined;

/** The URL a launch was asked to open: every command this module builds carries it last. */
export function urlLauncher(sink: (url: string) => void): Launch {
	return (_command, args) => {
		sink(args.at(-1) ?? "");
		return undefined;
	};
}

/** What the policy decided, before any launcher failure is known. */
export type OpenOutcome = "opened" | "skipped-remote" | "skipped-off";

/** The decision a page makes, and where its launcher comes from. */
export interface OpenPageOptions {
	/** The project's `serve.autoOpen`: whether a page opens a tab at all. */
	autoOpen: boolean;
	/** Whether this turn is answered from outside the terminal (`isRemoteTurn`). */
	remote: boolean;
	/** The launcher; a test hands one in so nothing is started. */
	launch?: Launch;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	/** Called at most once, with the launcher's own words, when no tab opened. */
	onFailure?: (reason: string) => void;
}

/**
 * Spawn an OS handler detached, so the application outlives the session: a tab for a
 * page here, an application for a file in `file-open`. The handler's output belongs to
 * the browser or the launcher, never to the transcript, so it is discarded.
 */
export function launchDetached(command: string, args: string[]): LauncherChild {
	const child = spawn(command, args, { detached: true, stdio: "ignore" });
	child.unref();
	return child;
}

/**
 * Open `url` in the browser, or say why the page is showing a URL instead.
 *
 * A remote turn is skipped before the switch is read: a WeChat or SSH session has no
 * browser in front of the person, so a tab there is one nobody sees. The returned
 * outcome is the policy's answer; a launcher that fails afterwards arrives through
 * `onFailure`, which is why the return value is not the last word.
 */
export function openPageInBrowser(url: string, options: OpenPageOptions): OpenOutcome {
	if (options.remote) return "skipped-remote";
	if (!options.autoOpen) return "skipped-off";
	const launch = options.launch ?? launchDetached;
	// A start failure and a non-zero exit both arrive asynchronously, and both can fire
	// for one launch: the first one is the report.
	let reported = false;
	const report = (reason: string): void => {
		if (reported) return;
		reported = true;
		options.onFailure?.(reason);
	};
	try {
		const { command, args } = browserCommand(url, options.platform, options.env);
		const child = launch(command, args);
		child?.on("error", (error) => report(messageOf(error)));
		child?.on("exit", (code) => {
			if (code !== null && code !== 0) report(`${command} exited with code ${code}`);
		});
	} catch (error) {
		report(messageOf(error));
	}
	return "opened";
}
