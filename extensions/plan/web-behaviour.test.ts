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
function context(page: ReviewPageData): ReviewContext {
	return {
		caller: (token) => (token === "tok" ? { role: "owner" } : undefined),
		hosts: () => [...LOOPBACK_HOSTS],
		canApprove: true,
		page: async () => page,
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
function serve(page: ReviewPageData = PAGE): Promise<{ server: Server; origin: string }> {
	const ctx = context(page);
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

	test("boots with no script error, and its keys and view control answer", async () => {
		// The bundle is a string: no checker reads it, so the page itself is the only proof
		// that every helper it calls travelled with it. An undefined name there is a
		// ReferenceError on the first render, and the keymap's is on every content key.
		// The comment sits on a paragraph, so the filtered view has something to keep that
		// is not a heading.
		const local = await serve({
			...PAGE,
			annotations: [{ anchor: 1, comment: "needs a rollback step", author: "priya" }],
		});
		const errors: string[] = [];
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
		try {
			await page.goto(`${local.origin}/?token=tok`, { waitUntil: "load" });
			await page.waitForSelector("#plan .bf-block", { timeout: PAINT_MS });
			expect(errors).toEqual([]);

			// `j` walks the blocks the page drew, and `k` walks back: the two keys that read the
			// table, the surface, and the block list the bundle has to carry.
			const active = "#plan .bf-block--active";
			await page.keyboard.press("j");
			await page.keyboard.press("j");
			expect(await page.$eval(active, (node) => node.getAttribute("data-line"))).toBe("1");
			await page.keyboard.press("k");
			expect(await page.$eval(active, (node) => node.getAttribute("data-line"))).toBe("0");

			// The view control is one filter over what was drawn: the annotated block and the
			// headings stay, and the status line says how much it is hiding.
			await page.click('[data-view="comments"]');
			expect(
				await page.$$eval("#plan .bf-block:not([hidden])", (nodes) =>
					nodes.map((node) => node.getAttribute("data-line")),
				),
			).toEqual(["0", "1", "3"]);
			expect(await page.textContent("#status")).toContain("3 of 4");
			// A throw inside a handler is invisible in an image and fatal to the feature, so
			// the click gets the same clean-console assertion the boot did.
			expect(errors).toEqual([]);
		} finally {
			await page.close();
			await new Promise<void>((resolve) => local.server.close(() => resolve()));
		}
	});

	test("a filtered view hides a thread with its block, and the keys stay on what is shown", async () => {
		// One changed paragraph, one comment on a paragraph that did not change: the note has
		// no text left to refer to, so it goes with its block, and the keyboard has no business
		// landing on a block the reader cannot see.
		const local = await serve({
			...PAGE,
			changed: [1],
			blockMarks: true,
			annotations: [{ anchor: 4, comment: "needs a rollback step", author: "priya" }],
		});
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
		try {
			await page.goto(`${local.origin}/?token=tok`, { waitUntil: "load" });
			await page.waitForSelector("#plan .bf-block", { timeout: PAINT_MS });
			await page.click('[data-view="changed"]');
			expect(await page.$eval("#plan .bf-comments", (node) => node.hidden)).toBe(true);

			const active = "#plan .bf-block--active";
			await page.keyboard.press("j");
			expect(await page.$eval(active, (node) => node.getAttribute("data-line"))).toBe("0");
			await page.keyboard.press("j");
			expect(await page.$eval(active, (node) => node.getAttribute("data-line"))).toBe("1");
			// The next block is the hidden one: the step skips it and lands on the heading after.
			await page.keyboard.press("j");
			expect(await page.$eval(active, (node) => node.getAttribute("data-line"))).toBe("3");
			// Nothing visible is left past it, so the reader stays where they are.
			await page.keyboard.press("j");
			expect(await page.$eval(active, (node) => node.getAttribute("data-line"))).toBe("3");
		} finally {
			await page.close();
			await new Promise<void>((resolve) => local.server.close(() => resolve()));
		}
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
		// Nothing was carried, so nothing claims to be.
		expect(await page.$$eval(".bf-comment__moved", (nodes) => nodes.length)).toBe(0);
		await page.close();
	});

	test("marks a comment a refinement carried off the text it was written on", async () => {
		const carried: ReviewPageData = {
			...PAGE,
			annotations: [{ anchor: 1, comment: "needs a rollback step", author: "priya", moved: true }],
		};
		const local = await serve(carried);
		try {
			const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
			await page.goto(`${local.origin}/?token=tok`, { waitUntil: "load" });
			await page.waitForSelector(".bf-comment__moved", { timeout: PAINT_MS });
			const chip = page.locator(".bf-comment__moved");
			expect(await chip.textContent()).toBe("moved");
			// The refusal is in the tooltip as well as the chip: a reader who hovers learns
			// that the placement is a guess rather than the reviewer's own anchor.
			expect(await chip.getAttribute("title")).toContain("Written on an earlier revision");
			// Still her comment, in the rail of the block it was carried to.
			expect(await page.$eval('#plan .bf-block[data-line="1"]', (node) => node.className)).toContain(
				"bf-block--commented",
			);
			expect(await page.textContent("#plan .bf-comment__body")).toBe("needs a rollback step");
			await page.close();
		} finally {
			await new Promise<void>((resolve) => local.server.close(() => resolve()));
		}
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
