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

/**
 * The sentence a case fails with when the browser behind it died.
 *
 * Without it a death surfaces wherever the next await happened to be, wearing that case's own
 * budget: a 30-second timeout in a suite that takes 4 seconds, which reads as a defect in a file
 * the card never touched and costs a whole second gate run to explain. `undefined` means the
 * browser is up (or was closed by us), so a caller can rethrow its own error unchanged.
 */
export function browserDeath(browser: TestBrowser): Error | undefined {
	const exit = browser.exited();
	if (exit === undefined) return undefined;
	const how = exit.signal === null ? `code ${exit.code ?? "none"}` : `signal ${exit.signal}`;
	return new Error(
		`the headless browser exited (${how}) before this case — the machine, not the case: run it alone before calling it a defect`,
	);
}

/**
 * Throw the death, if there is one, before a case spends its budget on a browser that is gone.
 *
 * Called at the top of the paths that reuse a tab, because that is where a dead browser is met:
 * a suite that opens a tab per case already fails fast on the connection, and one that reloads a
 * shared tab waits out its own timeout instead.
 */
export function alive(browser: TestBrowser): void {
	const death = browserDeath(browser);
	if (death !== undefined) throw death;
}
