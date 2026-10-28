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
import { type Browser, chromium, type Page } from "playwright-core";
import { findChrome } from "../../scripts/capture/chrome.ts";
import { LOOPBACK_HOSTS } from "../../lib/http/index.ts";
import type { PlanAnnotation } from "./feedback.ts";
import type { ReviewContext, SaveResult } from "./web-router.ts";
import { handleReviewRequest } from "./web-router.ts";
import { testMountSource } from "../../test/helpers/serve.ts";
import type { ReviewPageData } from "./web-page.ts";

/** The browser this machine has; absent means the whole suite is skipped. */
const CHROME = findChrome();

/** How long the page gets to paint what the fixture holds. */
const PAINT_MS = 10_000;

/**
 * The prefix the fixture review answers under.
 *
 * The review's own shape, `/plan/<id>`, because the mount is what strips it: a page served
 * at the origin's root would not prove the page's own URLs are built from that prefix.
 */
const BASE = "/plan/probe";

/** A plan with two sections and one stored comment, which is the rail's whole reason. */
const ANNOTATION: PlanAnnotation = { anchor: 0, comment: "needs a rollback step", author: "priya" };

const PAGE: ReviewPageData = {
	base: BASE,
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
/** The page's own address, prefix included, and how a case gives the mount back. */
let reviewUrl = "";
let closeReview: () => Promise<void> = async () => {};

/**
 * The sliver of the DOM a predicate reads.
 *
 * This project's TypeScript has no DOM lib — the client is a string, so nothing here ever
 * compiled against one — and a predicate handed to Playwright is serialized into the page,
 * so it reaches the document through this shape by name.
 */
interface Doc {
	querySelector(selector: string): { textContent: string | null } | null;
	querySelectorAll(selector: string): { length: number };
}

/** The review's own router, answering the shipped page and its script over HTTP. */
function context(page: ReviewPageData): ReviewContext {
	return {
		caller: (token) => (token === "tok" ? { role: "owner" } : undefined),
		hosts: () => [...LOOPBACK_HOSTS],
		canApprove: true,
		page: async () => page,
		save: async (): Promise<SaveResult> => ({ ok: true }),
		share: async () => ({ state: { sharing: false, origin: "", links: [] } }),
		invite: async () => ({ state: { sharing: false, origin: "", links: [] } }),
		revoke: async () => ({ state: { sharing: false, origin: "", links: [] } }),
		stopShare: async () => ({ state: { sharing: false, origin: "", links: [] } }),
		onSaved: () => {},
		onApprove: () => {},
		onCancel: () => {},
	};
}

/**
 * Serve one review: the shipped router, on the shipped mount.
 *
 * `testMountSource()` is the server `serve` runs, so the prefix stripping, the SSE head and
 * the close path are the real ones; the case owns the returned close.
 */
async function serve(
	page: ReviewPageData = PAGE,
	overrides: Partial<ReviewContext> = {},
): Promise<{ origin: string; url: string; close: () => Promise<void> }> {
	const ctx = { ...context(page), ...overrides };
	const mount = await testMountSource()({
		session: "s1",
		prefix: BASE,
		// The mount reads the body, so a POST reaches the router with what the page wrote;
		// the review's own cap is a megabyte.
		maxBodyBytes: 1024 * 1024,
		async handler(request) {
			const answer = await handleReviewRequest(ctx, request.method, request.url, request.headers, request.body);
			// The router answers a stream marker; the mount needs the sink that goes with it.
			return answer.stream ? { result: answer, openSink: () => () => {} } : { result: answer };
		},
	});
	if (mount.kind !== "mounted") throw new Error(`the review did not mount: ${mount.reason}`);
	const { origin, base, release } = mount.mount;
	return { origin, url: `${origin}${base}/?token=tok`, close: release };
}

/** One tab on the served review, waited until its blocks have painted. */
async function openPage(): Promise<Page> {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
	await page.goto(reviewUrl, { waitUntil: "load" });
	await page.waitForSelector("#plan .bf-block", { timeout: PAINT_MS });
	return page;
}

describe.skipIf(CHROME === undefined)("the served review", () => {
	beforeAll(async () => {
		const started = await serve();
		reviewUrl = started.url;
		closeReview = started.close;
		browser = await chromium.launch({ executablePath: CHROME, headless: true });
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
		await closeReview();
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
			await page.goto(local.url, { waitUntil: "load" });
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
			await local.close();
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
			await page.goto(local.url, { waitUntil: "load" });
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
			await local.close();
		}
	});

	test("a reviewer's second post keeps the name the server bound to her link", async () => {
		// She types `@alice`, the server stores and answers `alice`. If the page kept the
		// typed form, her first comment would stop being hers to edit and her next post —
		// which carries only what she still calls hers — would replace it with nothing.
		const saves: unknown[][] = [];
		const local = await serve(
			{ ...PAGE, role: "reviewer", canApprove: false, annotations: [] },
			{
				caller: (token) => (token === "tok" ? { role: "reviewer" } : undefined),
				save: async (annotations): Promise<SaveResult> => {
					saves.push(annotations.map((annotation) => ({ ...annotation })));
					return { ok: true, author: "alice" };
				},
			},
		);
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
		const post = async (text: string): Promise<void> => {
			await page.click('#plan .bf-block[data-line="1"] .bf-block__add');
			await page.fill(".bf-composer textarea", text);
			await page.click(".bf-composer .bf-btn--primary");
			await page.click("#post");
			await page.waitForFunction(
				() =>
					/Posted/i.test(
						(globalThis as unknown as { document: Doc }).document.querySelector("#status")?.textContent ?? "",
					),
				undefined,
				{ timeout: PAINT_MS },
			);
		};
		try {
			await page.goto(local.url, { waitUntil: "load" });
			await page.waitForSelector("#plan .bf-block", { timeout: PAINT_MS });
			await page.click("#reviewer-name");
			await page.fill("#name-input", "@alice");
			await page.click("#name-save");

			await post("first note");
			// The router normalised the typed name on the way through, which is the whole reason
			// the page has to take its answer rather than keep what it was typed.
			expect(saves[0]).toEqual([{ anchor: 1, comment: "first note", author: "alice" }]);
			// The page now posts as the name the file uses, and shows it.
			expect(await page.textContent("#reviewer-name")).toContain("alice");
			expect(await page.textContent("#reviewer-name")).not.toContain("@alice");

			await post("second note");
			// Both comments, one author: nothing she wrote earlier was dropped from the post.
			expect(saves[1]).toEqual([
				{ anchor: 1, comment: "first note", author: "alice" },
				{ anchor: 1, comment: "second note", author: "alice" },
			]);
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("a view click refuses while a comment is half-written", async () => {
		// The filter repaints the document, and the repaint closes the composer: the click
		// answers with the same sentence the ways off the page use, and the text stays put.
		const page = await openPage();
		await page.click('#plan .bf-block[data-line="1"] .bf-block__add');
		await page.fill(".bf-composer textarea", "half a thought");
		await page.click('[data-view="comments"]');
		expect(await page.$$eval(".bf-composer", (nodes) => nodes.length)).toBe(1);
		expect(await page.textContent("#status")).toContain("Add or discard the comment you are writing.");
		await page.close();
	});

	test("a settled review offers no comment control, and the key opens nothing", async () => {
		const page = await openPage();
		await page.click("#approve");
		await page.click("#approve-confirm");
		// The review ends without returning to the terminal, because the stub answers the post.
		await page.waitForFunction(
			() => (globalThis as unknown as { document: Doc }).document.querySelectorAll("#plan .bf-block__add").length === 0,
			undefined,
			{ timeout: PAINT_MS },
		);
		expect(await page.textContent("#review-state")).toContain("Approved");
		expect(await page.textContent("#status")).toContain("Approved");

		// `c` would otherwise open a composer for a note nothing could save.
		await page.keyboard.press("c");
		expect(await page.$$eval(".bf-composer", (nodes) => nodes.length)).toBe(0);
		await page.close();
	});

	test("v cycles what the page shows, and refuses over a half-written comment", async () => {
		const local = await serve({ ...PAGE, changed: [1], blockMarks: true });
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
		const pressed = async (): Promise<string> =>
			page.$eval('[data-view][aria-pressed="true"]', (node) => node.getAttribute("data-view") ?? "");
		try {
			await page.goto(local.url, { waitUntil: "load" });
			await page.waitForSelector("#plan .bf-block", { timeout: PAINT_MS });
			expect(await pressed()).toBe("all");
			await page.keyboard.press("v");
			expect(await pressed()).toBe("changed");
			// The paragraph that did not change is gone; the headings and the changed one stay.
			expect(await page.$$eval("#plan .bf-block:not([hidden])", (nodes) => nodes.length)).toBe(3);
			await page.keyboard.press("v");
			expect(await pressed()).toBe("comments");
			await page.keyboard.press("v");
			expect(await pressed()).toBe("all");

			// Cycling repaints, which closes the composer: a typed comment refuses it. The key
			// only reaches the page once the textarea has given up the keyboard, so the reader's
			// focus is moved out (the composer stays open).
			await page.click('#plan .bf-block[data-line="1"] .bf-block__add');
			await page.fill(".bf-composer textarea", "half a thought");
			await page.evaluate(() =>
				(
					globalThis as unknown as { document: { activeElement: { blur?: () => void } | null } }
				).document.activeElement?.blur?.(),
			);
			await page.keyboard.press("v");
			expect(await pressed()).toBe("all");
			expect(await page.$$eval(".bf-composer", (nodes) => nodes.length)).toBe(1);
			expect(await page.inputValue(".bf-composer textarea")).toBe("half a thought");
			expect(await page.textContent("#status")).toContain("Add or discard the comment you are writing.");
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("n walks the commented blocks, and steps over one the view hides", async () => {
		// Three notes: the heading, the changed paragraph, and a paragraph the Changed view
		// hides. The walk lands on the two it can show and never on the one it cannot.
		const local = await serve({
			...PAGE,
			changed: [1],
			blockMarks: true,
			annotations: [
				{ anchor: 0, comment: "on the title" },
				{ anchor: 1, comment: "on the change" },
				{ anchor: 4, comment: "on the roll-out" },
			],
		});
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
		const active = async (): Promise<string | null> =>
			page.$eval("#plan .bf-block--active", (node) => node.getAttribute("data-line"));
		try {
			await page.goto(local.url, { waitUntil: "load" });
			await page.waitForSelector("#plan .bf-block", { timeout: PAINT_MS });
			await page.keyboard.press("v");
			await page.keyboard.press("n");
			expect(await active()).toBe("0");
			await page.keyboard.press("n");
			expect(await active()).toBe("1");
			// Block 4 carries a note and is hidden: the walk stops rather than landing on it.
			await page.keyboard.press("n");
			expect(await active()).toBe("1");
			await page.keyboard.press("N");
			expect(await active()).toBe("0");
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("Resolve settles the writer's own note, and the counts say so", async () => {
		const local = await serve({
			...PAGE,
			annotations: [
				{ anchor: 1, comment: "mine to settle" },
				{ anchor: 4, comment: "hers", author: "priya" },
			],
		});
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
		try {
			await page.goto(local.url, { waitUntil: "load" });
			await page.waitForSelector("#plan .bf-comment", { timeout: PAINT_MS });
			expect(await page.textContent("#comment-total")).toBe("2");
			// The owner's own note offers the action; the reviewer's does not.
			expect(await page.$$eval(".bf-comment__actions", (nodes) => nodes.length)).toBe(1);

			await page.click(".bf-comment__actions .bf-btn");
			expect(await page.$eval(".bf-comment", (node) => node.className)).toContain("bf-comment--resolved");
			// Settled: the body is gone, the quote stays, and the panel splits the count.
			expect(await page.$$eval(".bf-comment .bf-comment__body", (nodes) => nodes.length)).toBe(1);
			expect(await page.textContent("#comment-total")).toBe("1 open · 1 resolved");
			// Reopen puts it back.
			await page.click(".bf-comment__actions .bf-btn");
			expect(await page.$eval(".bf-comment", (node) => node.className)).not.toContain("bf-comment--resolved");
			expect(await page.textContent("#comment-total")).toBe("2");
		} finally {
			await page.close();
			await local.close();
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
			await page.goto(local.url, { waitUntil: "load" });
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
			await local.close();
		}
	});

	test("the sidebar hint stays a hint, and the facts row keeps its labels whole", async () => {
		// Two rules, both about a 260px panel: the hint line names the keys a reader reaches
		// for first and leaves the rest to `?`, and no fact's label is squeezed into a column
		// by the value beside it.
		const page = await openPage();
		// A string expression evaluates to `unknown`; this is the shape the page returns,
		// and the assertions below are what hold it to that.
		const panel = (await page.evaluate(`(function () {
			var hints = document.querySelector(".review-hints");
			var label = document.querySelector("#step-fact > span");
			var row = document.getElementById("step-fact");
			return {
				keys: document.querySelectorAll(".review-hints .bf-kbd").length,
				text: hints ? hints.textContent || "" : "",
				labelHeight: label ? label.getBoundingClientRect().height : 0,
				overflow: row ? row.scrollWidth - row.clientWidth : 0
			};
		})()`)) as { keys: number; text: string; labelHeight: number; overflow: number };
		expect(panel.keys).toBe(6);
		expect(panel.text).not.toContain("walk comments");
		expect(panel.text).not.toContain("to filter");
		// One line: a wrapped label measures its two rows, which is over 30px here.
		expect(panel.labelHeight).toBeLessThan(30);
		expect(panel.overflow).toBeLessThanOrEqual(1);
		await page.close();
	});

	test("draws a list marker with the kit's class, checked or not", async () => {
		// The marker's width and muted colour come from the kit rule; a bare marker class
		// matched nothing, so a plain bullet sat at a different width from a checked one.
		const local = await serve({
			...PAGE,
			blocks: [
				{ start: 0, end: 0, kind: "heading", lines: ["# Steps"] },
				{ start: 1, end: 1, kind: "list", lines: ["- a plain bullet"] },
				{ start: 2, end: 2, kind: "list", lines: ["- [x] a done step"] },
			],
			annotations: [],
			outline: [{ id: "s-0", line: 0, level: 1, text: "Steps" }],
		});
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
		try {
			await page.goto(local.url, { waitUntil: "load" });
			await page.waitForSelector("#plan .bf-block__li", { timeout: PAINT_MS });
			const markers = await page.$$eval("#plan .bf-block__li > span:first-child", (nodes) =>
				nodes.map((node) => ({
					cls: node.className,
					minWidth: (globalThis as unknown as { getComputedStyle(n: unknown): { minWidth: string } }).getComputedStyle(
						node,
					).minWidth,
				})),
			);
			expect(markers.map((marker) => marker.cls)).toEqual([
				"bf-block__marker",
				"bf-block__marker bf-block__marker--done",
			]);
			// Both wear the kit's class, so both get its width rather than the text default.
			expect(markers.every((marker) => marker.minWidth !== "auto")).toBe(true);
		} finally {
			await page.close();
			await local.close();
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
