/**
 * A headless browser for a suite, closed by killing it.
 *
 * The launch and its kill live in `scripts/capture/chrome.ts`, because a capture pays the same
 * four seconds for Chrome's own shutdown and has the same reason to skip it: a SIGKILL drops
 * the browser and its helper processes in ten milliseconds, with Playwright still removing the
 * profile. This is the test-facing half — a machine with no browser is a skip rather than a
 * throw, so the suites name `PI_CHROME` instead of reading a Playwright build error.
 */

import { type BrowserHandle, launchChrome } from "../../scripts/capture/chrome.ts";

/** One browser a suite drives, and the close that does not wait on Chrome. */
export type TestBrowser = BrowserHandle;

/** Boot one headless browser from `executablePath`, or say why a suite cannot. */
export async function launchBrowser(executablePath: string | undefined): Promise<TestBrowser> {
	// A suite that forgot its skip says so, rather than launching a browser this package does
	// not ship and reading a build error out of Playwright.
	if (executablePath === undefined) throw new Error("no browser on this machine: PI_CHROME names one");
	return launchChrome(executablePath);
}
