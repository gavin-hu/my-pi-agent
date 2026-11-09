/**
 * A headless browser for a suite, closed by killing it.
 *
 * Chrome's own shutdown asks this machine for four seconds once a page is open — measured
 * against the pages the board and the review serve, and no launch flag shortens it — while a
 * SIGKILL drops the browser and its six helper processes in ten milliseconds and Playwright
 * still removes the profile it made. Every browser suite pays its boot in `afterAll`, so the
 * close is a kill rather than a request.
 *
 * `launchServer` is the only handle on that process, so this boots one and connects to it:
 * what a suite drives is the browser, which is a `newPage` and a `close` that kills.
 */

import { type Browser, chromium } from "playwright-core";

/** One browser a suite drives, and the close that does not wait on Chrome. */
export interface TestBrowser {
	/** A fresh tab in this browser. */
	newPage: Browser["newPage"];
	/** Kill the browser and drop the connection; resolves in milliseconds. */
	close(): Promise<void>;
}

/** Boot one headless browser from `executablePath`, closed by {@link TestBrowser.close}. */
export async function launchBrowser(executablePath: string | undefined): Promise<TestBrowser> {
	// A suite that forgot its skip says so, rather than launching a browser this package does
	// not ship and reading a build error out of Playwright.
	if (executablePath === undefined) throw new Error("no browser on this machine: PI_CHROME names one");
	const launched = await chromium.launchServer({ executablePath, headless: true });
	const browser = await chromium.connect(launched.wsEndpoint());
	return {
		newPage: (options) => browser.newPage(options),
		close: async () => {
			launched.process()?.kill("SIGKILL");
			// Both resolve at once once the process is gone: the wait was the process exiting.
			await browser.close();
			await launched.close();
		},
	};
}
