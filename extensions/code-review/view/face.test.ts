/**
 * The faces a comment wears on the review page: the composer it is typed in, the thread it becomes,
 * the line that thread quotes, and the send dialog's list of comments.
 *
 * A suite of its own because the faces are one claim — prose reads as prose, code reads as code —
 * and the interaction suite is already past the size bar; `test/suite-sizes.test.ts` names it as
 * debt, which only a split lowers.
 *
 * Every assertion reads the `font-family` the browser computed, because the defect was an
 * inheritance: a thread is inserted inside the diff's `<code>`, so it wore whatever that element
 * resolved to without declaring a face of its own, and an assertion on the stylesheet is green on
 * it (#815). The mono stays where it is earned — the quoted line and the path a dialog names.
 *
 * A machine with no browser has `REVIEW_CHROME === undefined`, which `describe.skip` hands to the
 * suite so the gate stays green there and still says why nothing ran.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { launchBrowser, type TestBrowser } from "../../../test/helpers/browser.ts";
import {
	mountReviewPage,
	openReviewPage,
	REVIEW_CHROME,
	REVIEW_PAINT_MS,
	type ReviewPageFixture,
} from "../../../test/helpers/review-browser.ts";

/** A browser case pays a launch, a load, two interactions, and a resize. */
const CASE_MS = 30_000;

const gated = REVIEW_CHROME === undefined ? describe.skip : describe;

gated("the review page's comment faces", () => {
	let browser: TestBrowser;

	beforeAll(async () => {
		browser = await launchBrowser(REVIEW_CHROME);
	});

	afterAll(async () => {
		await browser?.close();
	});

	/** One fixture, one page, and the close both own. */
	async function withPage(run: (page: Page, fixture: ReviewPageFixture) => Promise<void>): Promise<void> {
		const fixture = await mountReviewPage();
		const page = await openReviewPage(browser, fixture);
		try {
			await run(page, fixture);
		} finally {
			await page.close();
			await fixture.close();
		}
	}

	/** Open the composer on the added line, which is the surface a reader types prose into. */
	async function openComposer(page: Page): Promise<void> {
		await page.locator(".bf-diff-line--add .browse-diff-no").filter({ hasText: /^\d+$/ }).first().click();
		await page.locator("#rv-sel-comment").click();
		// The press asks the session whether the tree moved before the box opens (#877), so the box is
		// a round trip away rather than the same tick.
		await page.waitForSelector(".rv-compose__area", { timeout: REVIEW_PAINT_MS });
	}

	/**
	 * One element's computed `font-family`, read in the page.
	 *
	 * Which face a surface wears is the browser's answer, not the stylesheet's: a thread inherits
	 * from the `<code>` it sits inside, and no rule in this page's sheet names that element.
	 */
	async function faceOf(page: Page, selector: string): Promise<string> {
		return page.evaluate((sel) => {
			const view = globalThis as unknown as {
				document: { querySelector(s: string): unknown };
				getComputedStyle(node: unknown): { fontFamily: string };
			};
			return view.getComputedStyle(view.document.querySelector(sel)).fontFamily;
		}, selector);
	}

	/** One box's scroll and client width: prose that does not wrap spills out of the box holding it. */
	async function widthsOf(page: Page, selector: string): Promise<{ scrollWidth: number; clientWidth: number }> {
		return page.evaluate((sel) => {
			const view = globalThis as unknown as {
				document: { querySelector(s: string): { scrollWidth: number; clientWidth: number } | null };
			};
			const node = view.document.querySelector(sel);
			return { scrollWidth: node === null ? -1 : node.scrollWidth, clientWidth: node === null ? -1 : node.clientWidth };
		}, selector);
	}

	/**
	 * A comment that carries a quote, written through the page's own route.
	 *
	 * The composer sets no quote, and the quoted line is the half of a thread that has to keep the
	 * code face, so the fixture supplies one. The token and the revision are the pair the page
	 * rendered and the pair its own writes send; the status is the case's to assert.
	 */
	async function seedQuotedComment(page: Page): Promise<number> {
		const island = JSON.parse((await page.locator("#rv-data").textContent()) ?? "{}") as {
			token: string;
			rev: string;
		};
		return page.evaluate(
			(payload) => {
				const view = globalThis as unknown as {
					document: { documentElement: { getAttribute(name: string): string | null } };
					fetch(input: string, init: unknown): Promise<{ status: number }>;
				};
				const base = view.document.documentElement.getAttribute("data-base") ?? "";
				return view
					.fetch(`${base}/api/comment`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(payload),
					})
					.then((answer) => answer.status);
			},
			{
				token: island.token,
				rev: island.rev,
				comment: {
					rel: "a.ts",
					line: 3,
					side: "new",
					quote: "const three = 3;",
					body: "Two sentences of prose, so the thread reads as a paragraph instead of as code. The second gives the wrap something to do at the narrow width.",
				},
			},
		);
	}

	test(
		"a comment's thread is prose in the page's face, and the code it quotes stays code",
		async () => {
			await withPage(async (page) => {
				expect(await seedQuotedComment(page), "the page's own route took the comment").toBe(200);
				await page.reload({ waitUntil: "networkidle" });
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });

				const prose = await faceOf(page, "body");
				const thread = await faceOf(page, ".rv-thread .bf-comment__body");
				expect(thread, "the thread is prose, like the page it sits in").toBe(prose);

				// The composer on the same line is the face a reader types into and compares the thread with.
				await openComposer(page);
				expect(await faceOf(page, ".rv-compose__area"), "the composer and the thread agree").toBe(thread);
				await page.locator(".rv-compose__acts .bf-btn--ghost").click();

				// The one thing in a thread that is code: the lines it quotes, in the diff's own face.
				const code = await faceOf(page, "pre.rv-diff");
				expect(await faceOf(page, ".rv-thread .bf-comment__quote"), "a quoted line is code").toBe(code);
				expect(thread, "and the prose beside it is not").not.toBe(code);

				// The send dialog's list: prose beside the path it names, which keeps the code face. Its
				// rows are built when the dialog opens, so the wait is the dialog's own fill.
				await page.locator("#rv-send").click();
				await page.waitForSelector(".rv-dialog-line", { timeout: REVIEW_PAINT_MS });
				expect(await faceOf(page, ".rv-dialog-line"), "the dialog's comment is prose").toBe(prose);
				expect(await faceOf(page, ".rv-dialog-path"), "the path it names is code").toBe(code);
				await page.locator("#rv-send-close").click();

				// Prose wraps in the box it is given at both widths rather than scrolling sideways inside
				// the diff's own scroll box; the face holds when the width changes under it.
				for (const width of [1280, 420]) {
					if (width !== 1280) await page.setViewportSize({ width, height: 900 });
					const box = await widthsOf(page, ".rv-thread");
					expect(box.scrollWidth, `the thread at ${width}px wraps`).toBeLessThanOrEqual(box.clientWidth);
					expect(await faceOf(page, ".rv-thread .bf-comment__body"), `the thread at ${width}px is prose`).toBe(prose);
				}
			});
		},
		CASE_MS,
	);
});
