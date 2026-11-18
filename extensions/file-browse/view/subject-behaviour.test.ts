/**
 * The identity row's subject, measured: where a reader sees the path's first character.
 *
 * The row is `direction: rtl` so a long path keeps the folder it names and loses the machine
 * (`lib/web/components.ts`), and an rtl paragraph moves a leading neutral character — the `/`
 * an absolute path opens with — to the visual end unless the label is isolated. Every string
 * assertion is green on that defect, because the page carried `/Users/…` in the DOM all along:
 * only a rendered box position can fail, so this suite reads one. The second case holds the
 * truncation the rtl is for, so a fix cannot buy the slash by giving that up.
 *
 * It needs a browser; where the machine has none it skips, naming `PI_CHROME`.
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

/** The browser this machine has; absent means the suite is skipped, naming `PI_CHROME`. */
const CHROME = findChrome();

/** How long one case may take: a boot, two loads, and a read of one row. */
const CASE_MS = 30_000;

/** The wide row the toolbar draws, and the narrow one that puts the subject on its own line. */
const WIDE = 1280;
const NARROW = 420;

/**
 * The sliver of the DOM a measurement reads, reached by name inside the page.
 *
 * This project's TypeScript has no DOM lib — the client is a string — so a suite that reads a
 * box declares the few members it touches rather than compiling against a whole one.
 */
interface Box {
	left: number;
	right: number;
	width: number;
}

interface Range {
	setStart(node: unknown, at: number): void;
	setEnd(node: unknown, at: number): void;
	selectNodeContents(node: unknown): void;
	getBoundingClientRect(): Box;
}

interface SubjectSpan {
	textContent: string | null;
	scrollWidth: number;
	clientWidth: number;
	title: string;
	firstChild: { textContent: string } | null;
	ownerDocument: { createRange(): Range };
	querySelector(selector: string): SubjectSpan | null;
	getBoundingClientRect(): Box;
	getAttribute(name: string): string | null;
}

/** What one width paints: the label, its first and last glyph, and the run they sit in. */
interface Subject {
	text: string;
	title: string;
	first: number;
	last: number;
	run: number;
	box: Box;
	clipped: number;
}

let browser: TestBrowser | undefined;
let server: FileServer | undefined;
let base = "";
let root = "";

/** The row at one width, measured from a fresh load. */
async function subjectAt(width: number): Promise<Subject> {
	if (server === undefined || browser === undefined) throw new Error("the suite's page was not served");
	const page: Page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
	try {
		await page.goto(server.url, { waitUntil: "load" });
		// Visible is the check a box needs: Playwright's own predicate is a non-empty rect, and
		// the page ships no webfont, so there is no later swap to wait for.
		await page.waitForSelector(".bf-context--subject", { state: "visible" });
		return await page.$eval(".bf-context--subject", (node) => {
			const span = node as unknown as SubjectSpan;
			// The isolate is the fix's own element; a span without one still measures, so the
			// case fails on the position rather than on a missing element.
			const label = span.querySelector("bdi") ?? span;
			const text = label.firstChild === null ? "" : label.firstChild.textContent;
			const draft = span.ownerDocument.createRange();
			const glyph = (at: number): number => {
				draft.setStart(label.firstChild, at);
				draft.setEnd(label.firstChild, at + 1);
				return draft.getBoundingClientRect().left;
			};
			const run = span.ownerDocument.createRange();
			run.selectNodeContents(span);
			return {
				text,
				title: span.getAttribute("title") ?? "",
				first: glyph(0),
				last: glyph(text.length - 1),
				run: run.getBoundingClientRect().left,
				box: span.getBoundingClientRect(),
				clipped: span.scrollWidth - span.clientWidth,
			};
		});
	} finally {
		await page.close();
	}
}

describe.skipIf(CHROME === undefined)("the identity row's subject", () => {
	beforeAll(async () => {
		// A root whose name is long enough to clip a narrow row and short enough to be whole in
		// the wide one: both cases assert that shape, so a machine whose `tmpdir()` moves it
		// fails here instead of proving nothing.
		base = mkdtempSync(join(tmpdir(), "pi-browse-subject-"));
		root = join(base, "a-served-folder-name-long-enough-to-clip", "second");
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "README.md"), "# Subject\n");
		const outcome = await createFileServer({
			root,
			config: { ...DEFAULT_CONFIG, autoOpen: false, live: false },
			mount: testMountSource(),
			session: "subject-behaviour",
		});
		if (outcome.kind !== "served") throw new Error(outcome.reason);
		server = outcome.server;
		browser = await launchBrowser(CHROME);
	}, CASE_MS);

	afterAll(async () => {
		await browser?.close();
		await server?.close();
		if (base !== "") rmSync(base, { recursive: true, force: true });
	}, CASE_MS);

	test("paints the path's slash at the head of the row, where the reader put it", async () => {
		const wide = await subjectAt(WIDE);
		// The label is still the whole served root, slash and all, and the hover still carries it.
		expect(wide.text).toBe(wide.title);
		expect(wide.text.startsWith("/")).toBe(true);
		// A clipped run starts off-screen, which would put both boxes outside together and make
		// the comparison below true by accident: the wide row says nothing is clipped first.
		expect(wide.clipped).toBe(0);
		// The defect: an rtl paragraph moves that neutral "/" behind the last letter, which the
		// shipped page measured at x=572 against a label starting at 165.
		expect(Math.abs(wide.first - wide.run)).toBeLessThanOrEqual(1);
	});

	test("keeps the head truncation the row exists for when the row is narrow", async () => {
		const wide = await subjectAt(WIDE);
		const narrow = await subjectAt(NARROW);
		// The fixture is the shape this case reads: whole in one row, clipped in the other.
		expect(wide.clipped).toBe(0);
		expect(narrow.clipped).toBeGreaterThan(0);
		// The machine name is what goes: the first glyph sits outside the row, and the folder a
		// reader is in keeps its last letter inside it.
		expect(narrow.first).toBeLessThan(narrow.box.left);
		expect(narrow.last).toBeLessThanOrEqual(narrow.box.right);
	});
});
