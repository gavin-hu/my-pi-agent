/**
 * The one opener: the command each platform runs, and every way opening ends.
 *
 * The failure cases are the point of the module. A launcher that cannot start reports
 * an async `'error'`, and one that starts and refuses reports a non-zero exit; neither
 * reaches a `try` block, so a case drives both by hand through the launcher seam.
 */

import { describe, expect, test } from "bun:test";
import { recordingLaunch } from "../test/helpers/launcher.ts";
import { browserCommand, openPageInBrowser, urlLauncher } from "./browser.ts";

const URL = "http://127.0.0.1:4781/board/?token=abc";

describe("browserCommand", () => {
	test("uses open on macOS, xdg-open elsewhere, and explorer on Windows", () => {
		expect(browserCommand(URL, "darwin", {})).toEqual({ command: "open", args: [URL] });
		expect(browserCommand(URL, "linux", {})).toEqual({ command: "xdg-open", args: [URL] });
		expect(browserCommand(URL, "win32", {})).toEqual({ command: "explorer", args: [URL] });
	});

	test("keeps a URL whole on Windows, so a query's '&' reaches the browser", () => {
		// `/board team` appends `&view=team`; `cmd /c start` would split the URL there.
		const command = browserCommand("http://127.0.0.1:4781/board&view=team", "win32", {});
		expect(command.args).toEqual(["http://127.0.0.1:4781/board&view=team"]);
		expect(command.command).not.toBe("cmd");
	});

	test("opens through $BROWSER on every platform, because setting it is a decision", () => {
		const env = { BROWSER: "firefox --new-tab" };
		expect(browserCommand(URL, "darwin", env)).toEqual({ command: "firefox", args: ["--new-tab", URL] });
		expect(browserCommand(URL, "linux", env)).toEqual({ command: "firefox", args: ["--new-tab", URL] });
	});

	test("ignores an empty $BROWSER", () => {
		expect(browserCommand(URL, "darwin", { BROWSER: "  " })).toEqual({ command: "open", args: [URL] });
	});

	test("opens through wslview under WSL, where xdg-open opens nothing", () => {
		expect(browserCommand(URL, "linux", { WSL_DISTRO_NAME: "Ubuntu" })).toEqual({ command: "wslview", args: [URL] });
	});
});

describe("openPageInBrowser", () => {
	test("starts the platform command with the URL, and says it opened", () => {
		const { launch, calls } = recordingLaunch();
		const outcome = openPageInBrowser(URL, { autoOpen: true, remote: false, launch, platform: "linux", env: {} });
		expect(outcome).toBe("opened");
		expect(calls).toEqual([{ command: "xdg-open", args: [URL] }]);
	});

	test("skips a remote turn before any launcher runs", () => {
		const { launch, calls } = recordingLaunch();
		expect(openPageInBrowser(URL, { autoOpen: true, remote: true, launch })).toBe("skipped-remote");
		expect(calls).toEqual([]);
	});

	test("skips a project that turned the switch off", () => {
		const { launch, calls } = recordingLaunch();
		expect(openPageInBrowser(URL, { autoOpen: false, remote: false, launch })).toBe("skipped-off");
		expect(calls).toEqual([]);
	});

	test("names a remote turn as remote even when the switch is off too", () => {
		// One reason is enough, and the one about the person's surroundings is the useful one.
		const { launch } = recordingLaunch();
		expect(openPageInBrowser(URL, { autoOpen: false, remote: true, launch })).toBe("skipped-remote");
	});

	test("reports a launcher that cannot start, and does not throw", () => {
		const { launch, child } = recordingLaunch();
		const reasons: string[] = [];
		expect(() =>
			openPageInBrowser(URL, { autoOpen: true, remote: false, launch, onFailure: (why) => reasons.push(why) }),
		).not.toThrow();
		child.fail('Executable not found in $PATH: "xdg-open"');
		expect(reasons).toEqual(['Executable not found in $PATH: "xdg-open"']);
	});

	test("reports a launcher that exits non-zero", () => {
		const { launch, child } = recordingLaunch();
		const reasons: string[] = [];
		openPageInBrowser(URL, {
			autoOpen: true,
			remote: false,
			launch,
			platform: "linux",
			onFailure: (why) => reasons.push(why),
		});
		child.exit(3);
		expect(reasons).toEqual(["xdg-open exited with code 3"]);
	});

	test("says nothing about an exit that succeeded, or one a signal ended", () => {
		const { launch, child } = recordingLaunch();
		const reasons: string[] = [];
		openPageInBrowser(URL, { autoOpen: true, remote: false, launch, onFailure: (why) => reasons.push(why) });
		child.exit(0);
		child.exit(null);
		expect(reasons).toEqual([]);
	});

	test("reports a launcher that throws as it starts", () => {
		const reasons: string[] = [];
		const outcome = openPageInBrowser(URL, {
			autoOpen: true,
			remote: false,
			launch: () => {
				throw new Error("no spawn here");
			},
			onFailure: (why) => reasons.push(why),
		});
		expect(outcome).toBe("opened");
		expect(reasons).toEqual(["no spawn here"]);
	});

	test("reports once when a start failure and an exit both arrive", () => {
		const { launch, child } = recordingLaunch();
		const reasons: string[] = [];
		openPageInBrowser(URL, { autoOpen: true, remote: false, launch, onFailure: (why) => reasons.push(why) });
		child.fail("gone");
		child.exit(1);
		expect(reasons).toEqual(["gone"]);
	});

	test("hands a suite's sink the URL, for a seam that records the tab instead of a spawn", () => {
		const opened: string[] = [];
		openPageInBrowser(URL, { autoOpen: true, remote: false, launch: urlLauncher((url) => opened.push(url)) });
		expect(opened).toEqual([URL]);
	});
});
