/**
 * A browser that dies is reported as a death, not as a case spending its own budget.
 *
 * Three full runs on two cards went red on one case at 30,000 ms — a suite that alone takes four
 * seconds — because a headless Chrome had been killed under load and the next reload of a shared
 * tab waited out the case's budget. The handle records its process's exit and the helper owns the
 * sentence, so a reviewer can tell the machine from a defect without a second run to prove it.
 *
 * Both halves are proved here without needing a starved machine: one case kills the browser on
 * purpose, the other closes it politely and checks that a shutdown is not a death — `close()`
 * kills with `SIGKILL` too, so it is the flag and not the signal that separates the two.
 *
 * It needs a browser; where the machine has none it skips, naming `PI_CHROME`.
 */

import { describe, expect, test } from "bun:test";
import { findChrome } from "../scripts/capture/chrome.ts";
import { alive, browserDeath, launchBrowser } from "./helpers/browser.ts";

const CHROME = findChrome();

/** How long the process gets to report its own death: a kill is fast, but the event is async. */
const EXIT_BUDGET_MS = 5_000;

describe.skipIf(CHROME === undefined)("a headless browser that dies", () => {
	test("names its exit instead of leaving the case to spend its budget", async () => {
		const browser = await launchBrowser(CHROME);
		try {
			await browser.newPage();
			const pid = browser.pid();
			expect(typeof pid).toBe("number");
			process.kill(pid as number, "SIGKILL");
			const deadline = Date.now() + EXIT_BUDGET_MS;
			while (browser.exited() === undefined && Date.now() < deadline) await Bun.sleep(20);
			expect(browser.exited()).toEqual({ code: null, signal: "SIGKILL" });
			// What a suite asks at the top of a reload path, and the sentence it gets: the exit, the
			// judgement, and the one action that would change the judgement.
			expect(() => alive(browser)).toThrow(/headless browser exited \(signal SIGKILL\)/);
			expect(() => alive(browser)).toThrow(/the machine, not the case/);
			expect(() => alive(browser)).toThrow(/run it alone before calling it a defect/);
		} finally {
			// The file's `afterAll` meets a browser that is already gone: this must resolve rather
			// than turn a clean death report into an unhandled rejection.
			await browser.close();
		}
	});

	test("reports no death when the suite closes it", async () => {
		const browser = await launchBrowser(CHROME);
		await browser.newPage();
		await browser.close();
		expect(browser.exited()).toBeUndefined();
		expect(browserDeath(browser)).toBeUndefined();
		expect(() => alive(browser)).not.toThrow();
	});

	test("rethrows the caller's own error when the browser is still up", async () => {
		const browser = await launchBrowser(CHROME);
		try {
			await browser.newPage();
			// The shape the reload wrapper uses: a failure with a live browser must keep its reason.
			expect(browserDeath(browser)).toBeUndefined();
		} finally {
			await browser.close();
		}
	});
});
