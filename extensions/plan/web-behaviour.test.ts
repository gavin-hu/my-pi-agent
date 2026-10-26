/**
 * The plan review page, driven the way a reviewer drives it.
 *
 * `web.test.ts` holds the router and reads the client bundle as text; neither can tell
 * whether the page works. This drives the shipped page and the shipped script through a
 * real browser: a block's comment control opens the composer, Escape peels the composer
 * before the review, a stored comment renders in its block's rail, and the outline jumps
 * to the section it names.
 *
 * Every assertion reads the shipped ids and classes, so a rewrite of the template strings
 * that keeps the contract keeps this green. Where the machine has no browser the suite
 * skips, naming `PI_CHROME`, so `bun run check` stays green without Chrome.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { type Browser, chromium, type Page } from "playwright-core";
import { findChrome } from "../../scripts/capture/chrome.ts";
import { LOOPBACK_HOSTS } from "../../lib/http/index.ts";
import type { PlanAnnotation } from "./feedback.ts";
import type { ReviewContext, SaveResult } from "./web-router.ts";
import { handleReviewRequest } from "./web-router.ts";
import type { ReviewPageData } from "./web-page.ts";

/** The browser this machine has; absent means the whole suite is skipped. */
const CHROME = findChrome();

/** How long the page gets to paint what the fixture holds. */
const PAINT_MS = 10_000;

/** A plan with two sections and one stored comment, which is the rail's whole reason. */
const ANNOTATION: PlanAnnotation = { anchor: 0, comment: "needs a rollback step", author: "priya" };

const PAGE: ReviewPageData = {
	title: "Add rate limiting",
	blocks: [
		{ start: 0, end: 0, kind: "heading", lines: ["# Add rate limiting"] },
		{ start: 1, end: 1, kind: "paragraph", lines: ["Start with the token bucket."] },
		{ start: 2, end: 2, kind: "blank", lines: [] },
		{ start: 3, end: 3, kind: "heading", lines: ["## Rollout"] },
		{ start: 4, end: 4, kind: "paragraph", lines: ["Ship behind a flag."] },
	],
	annotations: [ANNOTATION],
	outline: [
		{ id: "s-0", line: 0, level: 1, text: "Add rate limiting" },
		{ id: "s-3", line: 3, level: 2, text: "Rollout" },
	],
	steps: { done: 1, total: 3 },
	code: {},
	limits: { comments: 200, comment: 2000, quote: 500 },
	canApprove: true,
	role: "owner",
	token: "tok",
	rev: "rev-1",
};

let browser: Browser;
let server: Server;
let origin = "";

/**
 * The sliver of the DOM a predicate reads.
 *
 * This project's TypeScript has no DOM lib — the client is a string, so nothing here ever
 * compiled against one — and a predicate handed to Playwright is serialized into the page,
 * so it reaches the document through this shape by name.
 */
interface Doc {
	querySelector(selector: string): { textContent: string | null } | null;
}

/** The review's own router, answering the shipped page and its script over HTTP. */
function context(): ReviewContext {
	return {
		caller: (token) => (token === "tok" ? { role: "owner" } : undefined),
		hosts: () => [...LOOPBACK_HOSTS],
		canApprove: true,
		page: async () => PAGE,
		save: async (): Promise<SaveResult> => ({ ok: true }),
		share: async () => ({ state: { sharing: false, port: 0, links: [] } }),
		invite: async () => ({ state: { sharing: false, port: 0, links: [] } }),
		revoke: async () => ({ state: { sharing: false, port: 0, links: [] } }),
		stopShare: async () => ({ state: { sharing: false, port: 0, links: [] } }),
		onSaved: () => {},
		onApprove: () => {},
		onCancel: () => {},
	};
}

/** Serve one review: the router decides, so the page is the page the extension ships. */
function serve(): Promise<{ server: Server; origin: string }> {
	const ctx = context();
	const started = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", async () => {
			const url = request.url ?? "/";
			const body = Buffer.concat(chunks).toString("utf8");
			const answer = await handleReviewRequest(
				ctx,
				request.method ?? "GET",
				url.replace(/^http:\/\/[^/]+/, ""),
				{ host: request.headers.host ?? "" },
				body,
			);
			response.writeHead(answer.status, answer.headers);
			// The event stream is left open on purpose by the real router; a test does not
			// need it, so an empty body closes it and the page paints what it already has.
			response.end(answer.stream ? undefined : (answer.body ?? ""));
		});
	});
	return new Promise((resolve) => {
		started.listen(0, "127.0.0.1", () => {
			const address = started.address();
			const port = typeof address === "object" && address ? address.port : 0;
			resolve({ server: started, origin: `http://127.0.0.1:${port}` });
		});
	});
}

/** One tab on the served review, waited until its blocks have painted. */
async function openPage(): Promise<Page> {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
	await page.goto(`${origin}/?token=tok`, { waitUntil: "load" });
	await page.waitForSelector("#plan .bf-block", { timeout: PAINT_MS });
	return page;
}

describe.skipIf(CHROME === undefined)("the served review", () => {
	beforeAll(async () => {
		const started = await serve();
		server = started.server;
		origin = started.origin;
		browser = await chromium.launch({ executablePath: CHROME, headless: true });
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
		await new Promise<void>((resolve) => server?.close(() => resolve()));
	});

	test("draws the plan's blocks and names the plan in the header", async () => {
		const page = await openPage();
		expect(await page.textContent("#plan-title")).toBe("Add rate limiting");
		expect(await page.$$eval("#plan .bf-block", (nodes) => nodes.length)).toBe(4);
		// A heading block is an anchor, because a comment's `anchor` is its line.
		expect(await page.$eval("#plan #s-3", (node) => node.textContent ?? "")).toContain("Rollout");
		await page.close();
	});

	test("opens the composer from a block's control, and Escape peels it before the review", async () => {
		const page = await openPage();
		// The control is one per block and is what a reader clicks; it is inside the rail.
		await page.click('#plan .bf-block[data-line="1"] .bf-block__add');
		await page.waitForSelector(".bf-composer textarea", { timeout: PAINT_MS });
		await page.fill(".bf-composer textarea", "add a retry cap");
		// Escape closes the composer and nothing else: the review is still open, so a
		// second Escape would be the one that leaves it.
		await page.keyboard.press("Escape");
		await page.waitForFunction(
			() => (globalThis as unknown as { document: Doc }).document.querySelector(".bf-composer") === null,
			undefined,
			{ timeout: PAINT_MS },
		);
		expect(await page.$$eval(".bf-composer", (nodes) => nodes.length)).toBe(0);
		expect(await page.$eval("#plan", (node) => node.isConnected)).toBe(true);
		await page.close();
	});

	test("shows a stored comment in its block's rail, and counts it", async () => {
		const page = await openPage();
		expect(await page.textContent("#plan .bf-comment__label")).toContain("priya");
		expect(await page.textContent(".bf-comment")).toContain("needs a rollback step");
		// The block that carries it says so, and the header's count agrees.
		expect(await page.$eval('#plan .bf-block[data-line="0"]', (node) => node.className)).toContain(
			"bf-block--commented",
		);
		expect(await page.textContent("#comment-total")).toBe("1");
		await page.close();
	});

	test("jumps to the section the outline names", async () => {
		const page = await openPage();
		const links = page.locator("#outline-list a");
		expect(await links.count()).toBe(2);
		await links.nth(1).click();
		// The jump is a scroll to the section's anchor, so the section it names is the one
		// the page shows: the outline marks the current item.
		await page.waitForFunction(
			() =>
				(globalThis as unknown as { document: Doc }).document
					.querySelector('#outline-list a[aria-current="true"]')
					?.textContent?.includes("Rollout") ?? false,
			undefined,
			{ timeout: PAINT_MS },
		);
		await page.close();
	});
});
