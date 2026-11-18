/**
 * The review's deliberate endings, and the shortcut switch that makes a stray key harmless.
 *
 * Save, Post and Back to Pi used to run on one click or one letter, and the approval dialog
 * let `s` and `?` act behind it. These cases drive the shipped page: a dirty review asks
 * first and Keep reviewing leaves it whole, a clean one acts directly, a modal swallows the
 * content keys, and the `?` sheet's Keyboard shortcuts row persists off across a reload while
 * the buttons and `?` keep working.
 *
 * Where the machine has no browser the suite skips, naming `PI_CHROME`, so `bun run check`
 * stays green there.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { type TestBrowser } from "../../test/helpers/browser.ts";
import {
	type Doc,
	mountReview,
	openReview,
	REVIEW_CHROME,
	REVIEW_PAGE,
	REVIEW_PAINT_MS,
	launchReviewBrowser,
} from "../../test/helpers/plan-browser.ts";
import type { SaveResult } from "./web-router.ts";

let browser: TestBrowser;

/** Wait until the status line reads something matching `pattern`. */
async function awaitStatus(page: Page, pattern: RegExp): Promise<void> {
	await page.waitForFunction(
		(source) => {
			const text = (globalThis as unknown as { document: Doc }).document.querySelector("#status")?.textContent ?? "";
			return new RegExp(source).test(text);
		},
		pattern.source,
		{ timeout: REVIEW_PAINT_MS },
	);
}

/** Add one comment on block 1, which leaves the review's tab dirty. */
async function addComment(page: Page): Promise<void> {
	await page.click('#plan .bf-block[data-line="1"] .bf-block__add');
	await page.fill(".bf-composer textarea", "a note");
	await page.click(".bf-composer .bf-btn--primary");
	await page.waitForFunction(
		() => (globalThis as unknown as { document: Doc }).document.querySelector(".bf-composer") === null,
		undefined,
		{ timeout: REVIEW_PAINT_MS },
	);
}

describe.skipIf(REVIEW_CHROME === undefined)("the review's deliberate endings", () => {
	beforeAll(async () => {
		browser = await launchReviewBrowser();
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	test("Save asks first while a comment is unsaved, and Keep reviewing keeps it", async () => {
		const local = await mountReview(REVIEW_PAGE);
		const page = await openReview(browser, local.url);
		try {
			await addComment(page);
			await page.click("#save");
			expect(await page.isVisible("#confirm-dialog")).toBe(true);
			expect(await page.textContent("#confirm-title")).toBe("Save and return?");

			// Keep reviewing is the dialog's first control and the safe default: the review
			// stays, and the comment with it.
			await page.click("#confirm-cancel");
			expect(await page.isVisible("#confirm-dialog")).toBe(false);
			expect(await page.$eval("#plan", (node) => node.isConnected)).toBe(true);
			expect(await page.textContent("#comment-total")).toBe("2");

			await page.click("#save");
			await page.click("#confirm-accept");
			await awaitStatus(page, /Saved/);
			expect(await page.textContent("#review-state")).toContain("saved");
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("Back to Pi asks first, and leaving discards the tab's draft", async () => {
		const local = await mountReview(REVIEW_PAGE);
		const page = await openReview(browser, local.url);
		try {
			await addComment(page);
			await page.click("#cancel");
			expect(await page.textContent("#confirm-title")).toBe("Leave without saving?");
			await page.click("#confirm-cancel");
			expect(await page.$eval("#plan", (node) => node.isConnected)).toBe(true);

			await page.click("#cancel");
			await page.click("#confirm-accept");
			await awaitStatus(page, /Closed/);
			const draft = await page.evaluate(() =>
				(globalThis as unknown as { sessionStorage: { getItem(key: string): string | null } }).sessionStorage.getItem(
					"bf-review-draft",
				),
			);
			expect(draft).toBeNull();
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("Escape opens the same prompt while comments are unsaved", async () => {
		const local = await mountReview(REVIEW_PAGE);
		const page = await openReview(browser, local.url);
		try {
			await addComment(page);
			await page.keyboard.press("Escape");
			expect(await page.isVisible("#confirm-dialog")).toBe(true);
			expect(await page.textContent("#confirm-title")).toBe("Leave without saving?");
			await page.click("#confirm-cancel");
			expect(await page.$eval("#plan", (node) => node.isConnected)).toBe(true);
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("Post asks first, and posting keeps the review open", async () => {
		const saves: unknown[][] = [];
		const local = await mountReview(
			{ ...REVIEW_PAGE, role: "reviewer", canApprove: false, annotations: [] },
			{
				caller: (token) => (token === "tok" ? { role: "reviewer" } : undefined),
				save: async (annotations): Promise<SaveResult> => {
					saves.push(annotations.map((annotation) => ({ ...annotation })));
					return { ok: true, author: "alice" };
				},
			},
		);
		const page = await openReview(browser, local.url);
		try {
			await page.click("#reviewer-name");
			await page.fill("#name-input", "alice");
			await page.click("#name-save");
			await addComment(page);

			await page.click("#post");
			expect(await page.textContent("#confirm-title")).toBe("Post comments?");
			await page.click("#confirm-accept");
			await awaitStatus(page, /posted/);
			expect(saves).toHaveLength(1);
			expect(await page.$eval("#post", (node) => (node as unknown as { disabled: boolean }).disabled)).toBe(false);
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("a clean review saves without asking", async () => {
		const local = await mountReview(REVIEW_PAGE);
		const page = await openReview(browser, local.url);
		try {
			await page.click("#save");
			expect(await page.isVisible("#confirm-dialog")).toBe(false);
			await awaitStatus(page, /Saved/);
			expect(await page.textContent("#review-state")).toContain("saved");
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("a modal owns the keyboard, including ?", async () => {
		const local = await mountReview(REVIEW_PAGE);
		const page = await openReview(browser, local.url);
		try {
			await addComment(page);
			await page.click("#save");
			expect(await page.isVisible("#confirm-dialog")).toBe(true);
			// The sheet must not open behind a dialog, and no content key may act there.
			await page.keyboard.press("?");
			expect(await page.isVisible("#keys-dialog")).toBe(false);
			await page.keyboard.press("c");
			expect(await page.$$eval(".bf-composer", (nodes) => nodes.length)).toBe(0);
			await page.click("#confirm-cancel");

			// The approval dialog is modal in the same way.
			await page.keyboard.press("a");
			expect(await page.isVisible("#approve-dialog")).toBe(true);
			await page.keyboard.press("?");
			expect(await page.isVisible("#keys-dialog")).toBe(false);
			await page.click("#approve-cancel");
		} finally {
			await page.close();
			await local.close();
		}
	});

	test("the shortcut toggle turns the content keys off and survives a reload", async () => {
		const local = await mountReview(REVIEW_PAGE);
		const page = await openReview(browser, local.url);
		try {
			await page.click("#keys-open");
			await page.uncheck("#shortcuts-toggle");
			expect(await page.textContent("#status")).toContain("Keyboard shortcuts off.");
			await page.click("#keys-close");
			expect(await page.isVisible(".review-hints")).toBe(false);

			// No content key acts, and the buttons stop advertising one.
			await page.keyboard.press("a");
			expect(await page.isVisible("#approve-dialog")).toBe(false);
			await page.keyboard.press("c");
			expect(await page.$$eval(".bf-composer", (nodes) => nodes.length)).toBe(0);
			expect(await page.$eval("#approve", (node) => node.getAttribute("aria-keyshortcuts"))).toBeNull();

			// `?` still opens the sheet that turns them back on.
			await page.keyboard.press("?");
			expect(await page.isVisible("#keys-dialog")).toBe(true);
			expect(await page.$eval("#shortcuts-toggle", (node) => (node as unknown as { checked: boolean }).checked)).toBe(
				false,
			);

			await page.reload({ waitUntil: "load" });
			await page.waitForSelector("#plan .bf-block", { timeout: REVIEW_PAINT_MS });
			expect(await page.isVisible(".review-hints")).toBe(false);
			await page.click("#keys-open");
			expect(await page.$eval("#shortcuts-toggle", (node) => (node as unknown as { checked: boolean }).checked)).toBe(
				false,
			);
			await page.check("#shortcuts-toggle");
			await page.click("#keys-close");
			await page.keyboard.press("a");
			expect(await page.isVisible("#approve-dialog")).toBe(true);
		} finally {
			await page.close();
			await local.close();
		}
	});
});
