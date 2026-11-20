/**
 * The quick-open palette's empty state: the one place a reader is told what the search covered.
 *
 * The words are the client's, so the cases here open the shipped dialog and read it — a string
 * assertion is green on a bundle the browser never runs, and one written for this fragment was
 * (an escaped slash in a regex is unwritten by the template literal carrying it, and the whole
 * script stopped parsing). The answer those words are built from is checked beside them, because
 * the list of refused folders travels on the wire: the client names no directory, so a name added
 * to the walk reaches this message with no client edit.
 *
 * The rendered cases need a browser; where the machine has none they skip, naming `PI_CHROME`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { findChrome } from "../../../scripts/capture/chrome.ts";
import { launchBrowser, type TestBrowser } from "../../../test/helpers/browser.ts";
import { testMountSource } from "../../../test/helpers/serve.ts";
import { DEFAULT_CONFIG } from "../config/config.ts";
import { createFileServer, type FileServer } from "../transport/server.ts";
import { CLIENT_JS } from "./client.ts";

/** The browser this machine has; absent means the rendered cases skip, naming `PI_CHROME`. */
const CHROME = findChrome();

/** How long one case may take: a boot, a load, and a search. */
const CASE_MS = 30_000;

/** What the dialog's status line says, as the page drew it. */
interface Status {
	text: string;
	/** True when the line is wider than its box, which would hide the end of the sentence. */
	clipped: boolean;
	/** The line's own height, so a wrapped sentence is visible as one. */
	height: number;
}

let browser: TestBrowser | undefined;
let skippedRoot: FileServer | undefined;
let cleanRoot: FileServer | undefined;
let base = "";

/** The status line one query leaves in the dialog, on one root. */
async function statusAt(server: FileServer | undefined, query: string): Promise<Status> {
	if (server === undefined || browser === undefined) throw new Error("the suite's pages were not served");
	const page: Page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	try {
		await page.goto(server.url, { waitUntil: "load" });
		await page.waitForFunction(
			() => typeof (globalThis as unknown as { bfPalette?: { open?: unknown } }).bfPalette?.open === "function",
			undefined,
			{ timeout: CASE_MS },
		);
		await page.evaluate(() => {
			(globalThis as unknown as { bfPalette: { open(): void } }).bfPalette.open();
		});
		await page.waitForSelector("#palette-input");
		const read = () =>
			page.evaluate(
				() =>
					(
						globalThis as unknown as { document: { querySelector(s: string): { textContent: string } | null } }
					).document.querySelector(".bf-dialog__status")?.textContent ?? "",
			);
		const before = await read();
		await page.fill("#palette-input", query);
		// The dialog answers once per keystroke burst, so the read waits for the line the query
		// left rather than for a timer.
		await page.waitForFunction(
			(previous) => {
				const doc = (
					globalThis as unknown as { document: { querySelector(s: string): { textContent: string } | null } }
				).document;
				const text = doc.querySelector(".bf-dialog__status")?.textContent ?? "";
				return text !== "" && !text.startsWith("Searching") && text !== previous;
			},
			before,
			{ timeout: CASE_MS },
		);
		return await page.evaluate(() => {
			const el = (globalThis as unknown as { document: { querySelector(s: string): unknown } }).document.querySelector(
				".bf-dialog__status",
			) as unknown as {
				textContent: string;
				scrollWidth: number;
				clientWidth: number;
				getBoundingClientRect(): { height: number };
			};
			return {
				text: el.textContent,
				clipped: el.scrollWidth > el.clientWidth + 1,
				height: Math.round(el.getBoundingClientRect().height),
			};
		});
	} finally {
		await page.close();
	}
}

/** A root with both refused directories, and one with neither. */
async function serveRoots(): Promise<void> {
	base = mkdtempSync(join(tmpdir(), "pi-palette-"));
	const dirty = join(base, "dirty");
	const clean = join(base, "clean");
	mkdirSync(join(dirty, ".git"), { recursive: true });
	mkdirSync(join(dirty, "node_modules"), { recursive: true });
	mkdirSync(clean, { recursive: true });
	writeFileSync(join(dirty, "README.md"), "# dirty\n");
	writeFileSync(join(clean, "README.md"), "# clean\n");
	for (const [root, name] of [
		[dirty, "dirty"],
		[clean, "clean"],
	] as const) {
		const outcome = await createFileServer({
			root,
			config: { ...DEFAULT_CONFIG, live: false },
			mount: testMountSource(),
			session: `palette-${name}`,
		});
		if (outcome.kind !== "served") throw new Error(outcome.reason);
		if (name === "dirty") skippedRoot = outcome.server;
		else cleanRoot = outcome.server;
	}
}

beforeAll(async () => {
	await serveRoots();
}, CASE_MS);

afterAll(async () => {
	await skippedRoot?.close();
	await cleanRoot?.close();
	if (base !== "") rmSync(base, { recursive: true, force: true });
}, CASE_MS);

describe("the palette's bundle", () => {
	test("takes the refused folders from the answer, not from a copy in the client", () => {
		expect(CLIENT_JS).toContain("paletteSkipped = data.skipped || []");
		// One owner: the set is `INDEX_IGNORED_DIRS` in files/index.ts, and the bundle names
		// neither directory, so a name added there reaches this message with no client edit.
		expect(CLIENT_JS).not.toContain("node_modules");
		expect(CLIENT_JS).not.toContain('".git"');
	});

	test("parses once spliced, which a fragment's escaping can undo", () => {
		// The fragments are template literals: an escape written for the browser is eaten by the
		// literal first, so a case that only greps the bundle stays green on a page that throws.
		expect(() => new Function(CLIENT_JS)).not.toThrow();
	});
});

describe("the answer the palette words itself from", () => {
	test("carries the folders the index refused, so the page can name them", async () => {
		if (skippedRoot === undefined) throw new Error("the suite's pages were not served");
		const response = await fetch(`${skippedRoot.url}api/files?q=`);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as { total: number; skipped: string[] };
		expect(payload.skipped).toEqual([".git", "node_modules"]);
		expect(payload.total).toBeGreaterThan(0);
	});
});

describe.skipIf(CHROME === undefined)("the empty state a reader is given", () => {
	beforeAll(async () => {
		browser = await launchBrowser(CHROME);
	}, CASE_MS);

	afterAll(async () => {
		await browser?.close();
	}, CASE_MS);

	test("names the folders the index refused, and how many files it did search", async () => {
		const status = await statusAt(skippedRoot, "zzzz");
		expect(status.text).toBe("No matches in 1 file; .git and node_modules not searched.");
		// One line, not a clipped one: the sentence is longer than the words it replaced.
		expect(status.clipped).toBe(false);
	});

	test("says a query for an excluded folder is not indexed, rather than No matches", async () => {
		expect((await statusAt(skippedRoot, "node_modules/react")).text).toBe(
			"Not indexed: node_modules — open it from the tree.",
		);
		// A pasted path starts with a slash; the same question gets the same answer.
		expect((await statusAt(skippedRoot, "/.git/config")).text).toBe("Not indexed: .git — open it from the tree.");
	});

	test("keeps the words it had for a root with nothing refused", async () => {
		expect((await statusAt(cleanRoot, "zzzz")).text).toBe("No matches");
	});
});
