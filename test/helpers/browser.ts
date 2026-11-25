/**
 * A headless browser for a suite: one per run, connected per file.
 *
 * The launch and its kill live in `scripts/capture/chrome.ts`, because a capture pays the same
 * four seconds for Chrome's own shutdown and has the same reason to skip it: a SIGKILL drops
 * the browser and its helper processes in ten milliseconds, with Playwright still removing the
 * profile. This is the test-facing half — a machine with no browser is a skip rather than a
 * throw, so the suites name `PI_CHROME` instead of reading a Playwright build error.
 *
 * A suite used to launch one browser per file: 285 ms of Chrome plus 145 ms of `playwright-core`
 * import, forty times, for a run that is one process. Now the run keeps one, recorded in a temp
 * file, and a file connects to it — measured at ~40 ms — and drops the connection when it is done.
 * The process outlives the file that started it, which is the price of Bun's test process not
 * running an exit handler (the fact `./lock.ts` records): the next run's first suite reaps it by
 * pid liveness, the same way a stale lock is taken over. `PI_NO_BROWSER_POOL=1` restores the
 * launch-and-kill behaviour for a repro that needs its own process.
 */

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type Page, chromium } from "playwright-core";
import {
	type BrowserExit,
	type BrowserHandle,
	type ChromeServer,
	launchChrome,
	launchChromeServer,
} from "../../scripts/capture/chrome.ts";
import { processAlive } from "./lock.ts";

/** One browser a suite drives, and the close that does not wait on Chrome. */
export type TestBrowser = BrowserHandle;

/** What a run leaves for the next one: whose browser it is, which process, and its socket. */
interface PoolRecord {
	ownerPid: number;
	browserPid: number | undefined;
	wsEndpoint: string;
}

/**
 * The record's path: the machine's temp directory, so two checkouts share one browser.
 *
 * `PI_BROWSER_POOL_FILE` points the pool somewhere else, for a suite that has to create the live-pool
 * condition rather than hope for it: a file of its own keeps that browser out of every other checkout's
 * run, where writing the machine's record would hand them this suite's process and then take it away.
 */
function poolRecordPath(): string {
	return process.env.PI_BROWSER_POOL_FILE ?? join(tmpdir(), "my-pi-agent-browser.json");
}

/** The record the pool wrote last, or nothing when there is none or it is not readable. */
function readPoolRecord(): PoolRecord | undefined {
	let text: string;
	try {
		text = readFileSync(poolRecordPath(), "utf-8");
	} catch {
		return undefined;
	}
	const value = ((): unknown => {
		try {
			return JSON.parse(text);
		} catch {
			return undefined;
		}
	})();
	if (typeof value !== "object" || value === null) return undefined;
	const { ownerPid, browserPid, wsEndpoint } = value as Partial<Record<keyof PoolRecord, unknown>>;
	if (typeof ownerPid !== "number" || typeof wsEndpoint !== "string") return undefined;
	return { ownerPid, browserPid: typeof browserPid === "number" ? browserPid : undefined, wsEndpoint };
}

/** End a browser no file can reach any more, and drop the record that named it. */
function reap(record: PoolRecord): void {
	if (record.browserPid !== undefined && processAlive(record.browserPid)) {
		try {
			process.kill(record.browserPid, "SIGKILL");
		} catch {
			// It went between the check and the kill, which is the answer we wanted.
		}
	}
	rmSync(poolRecordPath(), { force: true });
}

/** The exit a pooled browser left, when this file did not spawn it and cannot name a code. */
const UNKNOWN_DEATH: BrowserExit = { code: null, signal: null };

/** Whether the recorded browser is still up, as far as a pid can say. */
function browserAlive(record: PoolRecord): boolean {
	return record.browserPid === undefined || processAlive(record.browserPid);
}

/**
 * A connected handle: the process belongs to the run, the connection to this file.
 *
 * `close()` drops this file's contexts and its connection, never the process — that is what makes
 * the next file's boot cheap, and what a `PI_NO_BROWSER_POOL=1` run opts out of.
 */
async function sharedHandle(record: PoolRecord, browser: Browser, server?: ChromeServer): Promise<BrowserHandle> {
	let closed = false;
	return {
		newPage: (options) => browser.newPage(options),
		close: async () => {
			if (closed) return;
			closed = true;
			// A disconnect leaves the contexts behind in a browser that stays up, so a run of forty
			// files would accumulate forty of them. Closing them here is this file's own cleanup.
			for (const context of browser.contexts()) await context.close().catch(() => undefined);
			await browser.close().catch(() => undefined);
		},
		exited: () => {
			if (closed) return undefined;
			const reported = server?.exited();
			if (reported !== undefined) return reported;
			return browserAlive(record) ? undefined : UNKNOWN_DEATH;
		},
		pid: () => record.browserPid,
	};
}

/** Connect to the recorded browser, or nothing when it is gone. */
async function connectTo(record: PoolRecord): Promise<Browser | undefined> {
	if (!browserAlive(record)) return undefined;
	try {
		return await chromium.connect(record.wsEndpoint);
	} catch {
		return undefined;
	}
}

/** The run's one browser: reconnect to it when it is up, boot it when it is not. */
async function pooledBrowser(executablePath: string): Promise<BrowserHandle> {
	const kept = readPoolRecord();
	if (kept !== undefined) {
		const shared = await connectTo(kept);
		if (shared !== undefined) return sharedHandle(kept, shared);
		reap(kept);
	}
	const server = await launchChromeServer(executablePath);
	const browser = await chromium.connect(server.wsEndpoint);
	const record: PoolRecord = { ownerPid: process.pid, browserPid: server.pid(), wsEndpoint: server.wsEndpoint };
	writeFileSync(poolRecordPath(), `${JSON.stringify(record)}\n`);
	// Best effort: Bun's test process may not run this, and the next run's reap is what actually
	// bounds the process. It costs nothing when it does run.
	process.on("exit", () => {
		if (record.ownerPid === process.pid) server.kill();
	});
	return sharedHandle(record, browser, server);
}

/**
 * The window a browser case opens at, and the tab it opens in.
 *
 * A tab is the expensive half of a boot — measured at ~230 ms against ~30 ms to load a document
 * into one already open — and it costs a fresh context with it, so a suite buys one and each case
 * replaces its document. The viewport belongs to the tab rather than to the document, so it is put
 * back before every case: a case that shrank the window would otherwise draw the next one at that
 * width. One owner for that rule, because the plan review and the code review each had a copy.
 */
export const SUITE_VIEWPORT = { width: 1280, height: 900 } as const;

/** The tab each suite's browser keeps. One browser per run, so this is one per suite. */
const tabs = new WeakMap<TestBrowser, Page>();

/** The suite's tab at the suite's window: the one it already has, or a first one. */
export async function suiteTab(browser: TestBrowser): Promise<Page> {
	const kept = tabs.get(browser);
	if (kept !== undefined && !kept.isClosed()) {
		await kept.setViewportSize(SUITE_VIEWPORT);
		return kept;
	}
	const page = await browser.newPage({ viewport: SUITE_VIEWPORT, reducedMotion: "reduce" });
	tabs.set(browser, page);
	return page;
}

/**
 * The binary a suite passes, or the sentence that says why it cannot have one.
 *
 * A suite that forgot its skip says so, rather than launching a browser this package does not ship and
 * reading a build error out of Playwright.
 */
function requireBrowser(executablePath: string | undefined): string {
	if (executablePath === undefined) throw new Error("no browser on this machine: PI_CHROME names one");
	return executablePath;
}

/** Boot or join the run's browser from `executablePath`, or say why a suite cannot. */
export async function launchBrowser(executablePath: string | undefined): Promise<TestBrowser> {
	const binary = requireBrowser(executablePath);
	if (process.env.PI_NO_BROWSER_POOL === "1") return launchChrome(binary);
	return pooledBrowser(binary);
}

/**
 * Boot a browser this file owns, for a case that has to read *how* it went.
 *
 * A handle joined to the pool carries no child process, so its `exited()` can only ever be
 * `UNKNOWN_DEATH` (`{ code: null, signal: null }`): the exit event reaches the process that spawned the
 * child and no other. A case asserting a signal therefore must not join the run's browser — and a case
 * that kills a browser it does not own takes the run's browser down with it.
 */
export async function launchOwnBrowser(executablePath: string | undefined): Promise<TestBrowser> {
	return launchChrome(requireBrowser(executablePath));
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

/**
 * One call on a browser, reported as a death when the browser went rather than as the call's error.
 *
 * The check before the call covers a browser already gone; the catch covers the one that went
 * between the two, which is the narrow window a reload lands in. A live browser keeps its own
 * error untouched — that is the half a reader cannot see from the sentence, so the repro asserts
 * the same error comes back out rather than a rewritten one.
 */
export async function guarded<T>(browser: TestBrowser, call: () => Promise<T>): Promise<T> {
	alive(browser);
	try {
		return await call();
	} catch (error) {
		throw browserDeath(browser) ?? error;
	}
}
