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

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome } from "../scripts/capture/chrome.ts";
import { alive, browserDeath, guarded, launchBrowser, launchOwnBrowser, type TestBrowser } from "./helpers/browser.ts";

const CHROME = findChrome();

/**
 * The suite's own pool record, and the browser it names.
 *
 * Every case here used to join whatever browser the machine had, so the kill case's `SIGKILL` was
 * observable only when the pool happened to be cold — the state that made this file red under load and
 * green alone. Creating that state here is what turns the repro into a gate: the record is this suite's,
 * so no other checkout's run is touched, and the kill case below fails on a helper that joins it.
 */
const SUITE_POOL = join(tmpdir(), `my-pi-agent-browser-handle-${process.pid}.json`);
let pooled: TestBrowser | undefined;

/** How long the process gets to report its own death: a kill is fast, but the event is async. */
const EXIT_BUDGET_MS = 5_000;

describe.skipIf(CHROME === undefined)("a headless browser that dies", () => {
	/**
	 * Make the pool live before the cases run, so each one starts from the condition that used to break
	 * this file: a browser another process started, which a handle can join but cannot own.
	 */
	beforeAll(async () => {
		process.env.PI_BROWSER_POOL_FILE = SUITE_POOL;
		// Cold, because this record does not exist yet: the boot spawns the browser and writes the record,
		// and the process outlives the handle by design — which is what makes every later launch join.
		pooled = await launchBrowser(CHROME);
	}, 30_000);

	afterAll(async () => {
		const pid = pooled?.pid();
		// `close()` drops this file's connection and leaves the process up for the next file, so the
		// fixture owes both the kill and the record it wrote.
		await pooled?.close();
		if (typeof pid === "number") {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// Already gone, which is the state this hook wanted.
			}
		}
		rmSync(SUITE_POOL, { force: true });
		delete process.env.PI_BROWSER_POOL_FILE;
	}, 30_000);

	test("names its exit instead of leaving the case to spend its budget", async () => {
		// Own the process: a joined handle cannot name a death (see the last case here), and the signal
		// asserted below is only observable from the process that spawned the child.
		const browser = await launchOwnBrowser(CHROME);
		try {
			await browser.newPage();
			const pid = browser.pid();
			expect(typeof pid).toBe("number");
			process.kill(pid as number, "SIGKILL");
			const deadline = Date.now() + EXIT_BUDGET_MS;
			while (browser.exited() === undefined && Date.now() < deadline) await Bun.sleep(20);
			const exit = browser.exited();
			// POSIX reports the signal, Windows the code the browser went down with: the sentence is
			// built from whichever this platform answers, so the case reads the death `browserDeath`
			// writes rather than one platform's shape.
			expect(exit).toBeDefined();
			if (process.platform === "win32") expect(exit).toEqual({ code: expect.any(Number), signal: null });
			else expect(exit).toEqual({ code: null, signal: "SIGKILL" });
			const how = exit?.signal === null ? `code ${exit?.code}` : `signal ${exit?.signal}`;
			// What a suite asks at the top of a reload path, and the sentence it gets: the exit, the
			// judgement, and the one action that would change the judgement.
			expect(() => alive(browser)).toThrow(`headless browser exited (${how})`);
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

	test("hands a live browser's own error back untouched", async () => {
		const browser = await launchBrowser(CHROME);
		try {
			await browser.newPage();
			// The one line in the wrapper that could regress silently: delete the fallback and every
			// live-browser failure becomes `undefined`, which no other case here would notice.
			const mine = new Error("a bad path, not a dead browser");
			await expect(guarded(browser, () => Promise.reject(mine))).rejects.toBe(mine);
		} finally {
			await browser.close();
		}
	});

	test("reports the death rather than the call's error once the browser is gone", async () => {
		// Owned for the same reason as the first case, and for one more: killing the run's shared browser
		// would take a concurrent suite down with this one.
		const browser = await launchOwnBrowser(CHROME);
		try {
			await browser.newPage();
			process.kill(browser.pid() as number, "SIGKILL");
			const deadline = Date.now() + EXIT_BUDGET_MS;
			while (browser.exited() === undefined && Date.now() < deadline) await Bun.sleep(20);
			// The call's own failure is what a reload would report; the wrapper owes the death.
			await expect(guarded(browser, () => Promise.reject(new Error("connection refused")))).rejects.toThrow(
				/headless browser exited/,
			);
		} finally {
			await browser.close();
		}
	});

	test("a joined handle cannot name the death, which is why the cases above own one", async () => {
		// Last, because it spends the fixture's browser. This is the state the machine used to provide by
		// accident: a pooled browser another process started. A handle that joined it has no child, so the
		// exit event never reaches this process and all it can report is an exit with no cause.
		const joined = await launchBrowser(CHROME);
		const pid = joined.pid();
		expect(typeof pid).toBe("number");
		process.kill(pid as number, "SIGKILL");
		const deadline = Date.now() + EXIT_BUDGET_MS;
		while (joined.exited() === undefined && Date.now() < deadline) await Bun.sleep(20);
		expect(joined.exited()).toEqual({ code: null, signal: null });
	});
});
