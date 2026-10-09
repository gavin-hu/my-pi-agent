/**
 * Opening the default browser, cross-platform.
 *
 * `browserCommand` is pure so it can be asserted per platform; `openInBrowser`
 * takes an injectable spawn so tests never launch anything. Opening is
 * best-effort: a failure is swallowed because the URL is also printed.
 */

import { spawn } from "node:child_process";

export interface BrowserCommand {
	command: string;
	args: string[];
}

/** The command that opens `url` on `platform`. */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): BrowserCommand {
	if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
	if (platform === "darwin") return { command: "open", args: [url] };
	return { command: "xdg-open", args: [url] };
}

export type SpawnFn = (command: string, args: string[]) => unknown;

/** Launch the default browser at `url`, ignoring every failure. */
export function openInBrowser(url: string, options: { platform?: NodeJS.Platform; spawn?: SpawnFn } = {}): void {
	const spawnFn =
		options.spawn ??
		((command, args) => {
			spawn(command, args, { detached: true, stdio: "ignore" }).unref();
		});
	try {
		const { command, args } = browserCommand(url, options.platform);
		spawnFn(command, args);
	} catch {
		// Best effort; the URL is printed too.
	}
}
