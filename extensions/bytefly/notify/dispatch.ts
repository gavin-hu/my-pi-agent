/**
 * Delivery: turn one title/body into an OS notification.
 *
 * Pi has no desktop-notification API, so the capability mirrors Pi's own
 * `notify` example and speaks to the surfaces directly: OSC 777 (Ghostty,
 * iTerm2, WezTerm, rxvt-unicode), OSC 99 (Kitty), a Windows toast through
 * PowerShell, and — off a terminal — `osascript` on macOS or `notify-send` on
 * Linux.
 *
 * Everything the process touches is a seam ({@link NotifySeams}), so the
 * dispatch is a pure choice over `platform` / `env` / `stdout` and a test needs
 * neither a terminal nor a child process. Text is sanitized at this boundary:
 * a job label or a prompt title is model- or user-authored and must not be able
 * to smuggle a control character into an escape sequence or a shell argument.
 */

import { execFile } from "node:child_process";
import { sanitizeLine } from "../../../lib/format.ts";
import type { NotifyConfig, NotifyMethod } from "./types.ts";

/** Host seams; inject all of them in a test. */
export interface NotifySeams {
	/** Value of `process.platform`. */
	platform: NodeJS.Platform;
	/** Environment used to recognize the terminal and the session. */
	env: Readonly<Record<string, string | undefined>>;
	/** Where OSC sequences go; OSC is skipped unless this is a TTY. */
	stdout: { write(chunk: string): unknown; isTTY?: boolean };
	/** Fire a short-lived notifier command; the caller never waits for it. */
	run(command: string, args: string[]): void;
}

/** The production seams: this process's platform, environment, stdout, and `execFile`. */
export function defaultSeams(): NotifySeams {
	return {
		platform: process.platform,
		env: process.env,
		stdout: process.stdout,
		run: (command, args) => {
			try {
				execFile(command, args, { windowsHide: true }, () => {});
			} catch {
				// The notifier is best-effort; a missing command must not break a turn.
			}
		},
	};
}

/**
 * The method to use for one notification.
 *
 * `auto` prefers a terminal the notification is known to reach — the same
 * surfaces Pi's own example uses — because that works over SSH and needs no
 * process. Off a terminal it falls back to the platform's own notifier.
 */
export function resolveMethod(method: NotifyMethod, seams: NotifySeams): NotifyMethod {
	if (method !== "auto") return method;
	const { env, platform, stdout } = seams;
	if (env.WT_SESSION) return "toast";
	if (env.KITTY_WINDOW_ID) return "osc99";
	if (env.TERM_PROGRAM === "WezTerm" || env.TERM_PROGRAM === "iTerm.app" || env.GHOSTTY_RESOURCES_DIR) {
		return "osc777";
	}
	if (platform === "win32") return "toast";
	if (stdout.isTTY) return "osc777";
	if (platform === "darwin") return "osascript";
	if (platform === "linux") return "notify-send";
	return "osc777";
}

/** Quote a string as a PowerShell single-quoted literal (only `'` is doubled). */
function powershellLiteral(text: string): string {
	return text.replaceAll("'", "''");
}

/** AppleScript double-quoted string; the body is already one control-free line. */
function appleScriptLiteral(text: string): string {
	// `JSON.stringify` escapes quotes and backslashes the way AppleScript reads
	// them; sanitized one-line text never needs AppleScript's escapes beyond that.
	return JSON.stringify(text);
}

/** The Windows toast script Pi's example ships, with the literals escaped. */
function windowsToastScript(title: string, body: string): string {
	const type = "Windows.UI.Notifications";
	const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
	const template = `[${type}.ToastTemplateType]::ToastText01`;
	const toast = `[${type}.ToastNotification]::new($xml)`;
	return [
		`${mgr} > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
		`$nodes = $xml.GetElementsByTagName('text')`,
		// PowerShell 5.1 cannot index the live node list with `[0]`; `.Item(0)`
		// reads the single node without enumerating a collection AppendChild mutates.
		`$nodes.Item(0).AppendChild($xml.CreateTextNode('${powershellLiteral(body)}')) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('${powershellLiteral(title)}').Show(${toast})`,
	].join("; ");
}

/**
 * Send one notification, if the capability is on.
 *
 * A no-op when `config.enabled` is false, when the chosen method is OSC but
 * stdout is not a TTY (writing an escape sequence into captured output would
 * corrupt it), or when the notifier command is missing.
 */
export function sendNotification(config: NotifyConfig, title: string, body: string, seams: NotifySeams): void {
	if (!config.enabled) return;
	const safeTitle = sanitizeLine(title) || "Pi";
	const safeBody = sanitizeLine(body);
	if (!safeBody) return;

	switch (resolveMethod(config.method, seams)) {
		case "osc777": {
			if (!seams.stdout.isTTY) return;
			seams.stdout.write(`\x1b]777;notify;${safeTitle.replaceAll(";", " ")};${safeBody}\x07`);
			return;
		}
		case "osc99": {
			if (!seams.stdout.isTTY) return;
			// A fixed notification id: Kitty replaces the previous notification
			// instead of stacking, which is what a status-style alert wants.
			seams.stdout.write(`\x1b]99;i=1:d=0;${safeTitle}\x1b\\`);
			seams.stdout.write(`\x1b]99;i=1:p=body;${safeBody}\x1b\\`);
			return;
		}
		case "toast": {
			seams.run("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(safeTitle, safeBody)]);
			return;
		}
		case "osascript": {
			const script = `display notification ${appleScriptLiteral(safeBody)} with title ${appleScriptLiteral(safeTitle)}`;
			seams.run("osascript", ["-e", script]);
			return;
		}
		case "notify-send": {
			seams.run("notify-send", [safeTitle, safeBody]);
			return;
		}
	}
}
