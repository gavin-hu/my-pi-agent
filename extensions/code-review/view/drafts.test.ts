/**
 * The review page's drafts, in a browser: what an unsent comment is, where it comes back, and what
 * happens when the diff will not hold it.
 *
 * A draft is this tab's, one per line: opening a second composer must not take the first, a reload
 * brings back every draft whose line is drawn, one whose line moved says which line it came from,
 * and one whose file the page no longer draws is listed above the diff to discard. The writes those
 * drafts become are `writes.test.ts`; the page's reading is `interaction.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { launchBrowser, type TestBrowser } from "../../../test/helpers/browser.ts";
import {
	CASE_MS,
	reloadReview,
	REVIEW_CHROME,
	REVIEW_PAINT_MS,
	type ReviewDom,
	type ReviewPageFixture,
	type SeedComment,
	type SnapshotOptions,
	seedDrafts,
	startComment,
	storedDrafts,
	withReviewPage,
} from "../../../test/helpers/review-browser.ts";

const gated = REVIEW_CHROME === undefined ? describe.skip : describe;

gated("the review page's drafts", () => {
	let browser: TestBrowser;

	beforeAll(async () => {
		browser = await launchBrowser(REVIEW_CHROME);
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
	}, 30_000);

	/** The one launch, and the fixture-and-page ownership, the helper keeps for each suite. */
	const withPage = (
		run: (page: Page, fixture: ReviewPageFixture) => Promise<void>,
		options: SnapshotOptions = {},
		seed: readonly SeedComment[] = [],
	): Promise<void> => withReviewPage(browser, run, options, seed);

	test(
		"an unsent draft survives the diff moving, and saves on a current line",
		async () => {
			await withPage(async (page, fixture) => {
				await startComment(page, "keep this note");
				fixture.move();
				await reloadReview(page);

				const area = page.locator(".rv-compose__area");
				expect(await area.inputValue()).toBe("keep this note");
				expect(await page.locator(".rv-compose__note").textContent()).toContain("typed on the earlier diff");

				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
				expect(await page.locator(".rv-thread .bf-comment__body").textContent()).toBe("keep this note");
			});
		},
		CASE_MS,
	);

	/**
	 * A draft the page has moved is deleted by the identity it carries, not by the line it was typed
	 * on: the save used to forget the *new* anchor while the record kept the old one, so the text came
	 * back after every save and Send would post it a second time.
	 */
	test(
		"a draft relanded on a moved diff is gone once it is saved, and stays gone",
		async () => {
			await withPage(async (page, fixture) => {
				await startComment(page, "keep this note");
				// The line the draft was typed on leaves the diff, so the page relands it on the file's
				// first drawn row — the relocation whose stale key resurrected it.
				fixture.reshape({ start: 40 });
				await reloadReview(page);
				await page.waitForSelector(".rv-compose__area", { timeout: REVIEW_PAINT_MS });
				expect(await page.locator(".rv-compose__area").inputValue()).toBe("keep this note");

				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
				await reloadReview(page);

				expect(await page.locator(".rv-compose").count()).toBe(0);
				expect(await page.locator(".rv-thread .bf-comment__body").count()).toBe(1);
			});
		},
		CASE_MS,
	);

	/**
	 * The stored shape changed, so a reviewer mid-review must not lose what they typed: a record keyed
	 * by its anchor, carrying no id, comes back on first load and is one id-keyed record after — the
	 * id the composer now wears, which is what a save deletes.
	 */
	test(
		"an anchor-keyed record from before identities comes back as one id-keyed record",
		async () => {
			await withPage(async (page) => {
				await startComment(page, "kept from before");
				const legacy = await storedDrafts(page);
				const [minted] = Object.keys(legacy);
				const record = legacy[minted];
				// The shape this page wrote before drafts had identities: keyed by the anchor, no id. A value that
				// is not a record is dropped by the same pass, so the store holds one record afterwards.
				const anchor = JSON.stringify([record.path, record.line, record.side]);
				delete record.id;
				await seedDrafts(page, { [anchor]: record, "not-a-record": "junk" });
				await reloadReview(page);

				expect(await page.locator(".rv-compose__area").inputValue()).toBe("kept from before");
				const kept = await storedDrafts(page);
				const keys = Object.keys(kept);
				expect(keys).toHaveLength(1);
				expect(kept[keys[0]].id).toBe(keys[0]);
				expect(await page.locator(".rv-compose").getAttribute("data-draft-id")).toBe(keys[0]);
			});
		},
		CASE_MS,
	);

	/**
	 * Two records can want one line: a drawn draft, and a relocated one whose file's first drawn row is
	 * that same line. The box already there is the identity — it holds the text its reader is typing in —
	 * so the incoming record goes rather than surviving beside it. Left as it was, the box kept A's id
	 * while the restore wrote B's text into it, so the store held two records for one composer and the
	 * save forgot the wrong one.
	 */
	test(
		"a relocated draft landing on a line already being typed on leaves one record, not two",
		async () => {
			await withPage(async (page) => {
				await startComment(page, "first note");
				const seeded = await storedDrafts(page);
				const [firstId] = Object.keys(seeded);
				const real = seeded[firstId];
				// The file's first drawn row, read by the page's own rule: the second gutter number wins, else
				// the first. That is where a draft whose line is gone relocates to.
				const rows = page.locator(`.bf-diff[data-path="${real.path}"] .bf-diff-line`);
				let at: { side: string; line: number } | null = null;
				for (let index = 0; index < (await rows.count()) && at === null; index += 1) {
					const numbers = await rows.nth(index).locator(".browse-diff-no").allTextContents();
					const next = numbers[1] === undefined ? Number.NaN : Number(numbers[1].trim());
					const old = numbers[0] === undefined ? Number.NaN : Number(numbers[0].trim());
					if (next) at = { side: "new", line: next };
					else if (old) at = { side: "old", line: old };
				}
				expect(at).not.toBeNull();
				if (at === null) return;
				// A drawn at that row; B typed on a line this diff no longer draws, so its restore lands there.
				const drawn = {
					id: "d-drawn",
					rev: real.rev,
					path: real.path,
					line: at.line,
					side: at.side,
					text: "first note",
				};
				const incoming = {
					id: "d-incoming",
					rev: real.rev,
					path: real.path,
					line: 999,
					side: at.side,
					text: "second note",
				};
				await seedDrafts(page, { [drawn.id]: drawn, [incoming.id]: incoming });
				await reloadReview(page);

				// One box, one record, and the box wears the id the save will delete.
				expect(await page.locator(".rv-compose").count()).toBe(1);
				expect(await page.locator(".rv-compose").getAttribute("data-draft-id")).toBe(drawn.id);
				expect(Object.keys(await storedDrafts(page))).toEqual([drawn.id]);

				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
				await reloadReview(page);

				expect(await page.locator(".rv-compose").count()).toBe(0);
				expect(await page.locator(".rv-thread .bf-comment__body").count()).toBe(1);
			});
		},
		CASE_MS,
	);

	/**
	 * One composer per line: opening a second must not take the first, a reload brings back both
	 * with their own text, and a save closes the composer it belongs to and no other.
	 */
	test(
		"two composers hold their own text, and one save leaves the other",
		async () => {
			await withPage(
				async (page) => {
					await startComment(page, "note on the added line");
					await page
						.locator(".bf-diff-line")
						.nth(1)
						.locator(".browse-diff-no")
						.filter({ hasText: /^\d+$/ })
						.first()
						.click();
					await page.locator("#rv-sel-comment").click();
					// The press asks the session whether the tree moved before it opens anything, so the
					// second box is a round trip away rather than the same tick (#877).
					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-compose").length === 2,
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					expect(await page.locator(".rv-compose").count()).toBe(2);
					await page
						.locator(".rv-compose", { hasText: "a.ts:17" })
						.locator(".rv-compose__area")
						.fill("note on the context line");

					await reloadReview(page);
					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-compose").length === 2,
						undefined,
						{
							timeout: REVIEW_PAINT_MS,
						},
					);
					const restored = [
						await page.locator(".rv-compose__area").nth(0).inputValue(),
						await page.locator(".rv-compose__area").nth(1).inputValue(),
					];
					expect(restored.sort()).toEqual(["note on the added line", "note on the context line"]);
					// A count is a fact a reader cannot act on; the lines are the half that moves them.
					const toast = await page.locator("#rv-toast").textContent();
					expect(toast).toContain("a.ts:17");
					expect(toast).toContain("a.ts:19");

					await page.locator(".rv-compose", { hasText: "a.ts:19" }).locator(".bf-btn--primary").click();
					await page.waitForFunction(
						() =>
							(globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-thread").length === 1 &&
							(globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-compose").length === 1,
						undefined,
						{ timeout: REVIEW_PAINT_MS },
					);
					expect(await page.locator(".rv-compose__area").inputValue()).toBe("note on the context line");
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);

	test(
		"a save returns focus to the cursor row",
		async () => {
			await withPage(
				async (page) => {
					await page.keyboard.press("j");
					await page.keyboard.press("Enter");
					await page.locator(".rv-compose__area").fill("note at 17");
					await page.locator(".rv-compose__acts .bf-btn--primary").click();
					await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
					expect(await page.locator("#rv-selbar-ref").textContent()).toBe("a.ts:17");
					expect((await page.evaluate("document.activeElement.className")) as string).toContain("bf-diff-line");
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);

	test(
		"a reply's composer comes back as a reply, and saves with the parent",
		async () => {
			await withPage(async (page) => {
				await startComment(page, "older");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
				await page.locator(".rv-thread").first().locator("button", { hasText: "reply" }).click();
				expect(await page.locator(".rv-compose__head").textContent()).toContain("reply on a.ts:3");
				await page.locator(".rv-compose__area").fill("answering older");

				await reloadReview(page);
				await page.waitForSelector(".rv-compose", { timeout: REVIEW_PAINT_MS });
				// The record carries the parent: a reload restores a reply as a reply rather than
				// demoting it to a comment, which is the failure a reader would never notice.
				expect(await page.locator(".rv-compose__head").textContent()).toContain("reply on a.ts:3");
				await page.locator(".rv-compose__acts .bf-btn--primary").click();
				await page.waitForFunction(
					() => (globalThis as unknown as ReviewDom).document.querySelectorAll(".rv-thread[data-parent]").length === 1,
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await page.locator(".rv-thread[data-parent] .bf-comment__body").textContent()).toBe("answering older");
			});
		},
		CASE_MS,
	);

	/**
	 * A draft whose line the diff stopped drawing but whose file it still draws: the text comes back
	 * on the file's first drawn row and says which line it was typed on, rather than moving silently.
	 */
	test(
		"a draft whose line moved comes back on a drawn line and says where it was typed",
		async () => {
			await withPage(
				async (page, fixture) => {
					await startComment(page, "note typed on 19");
					fixture.reshape({ start: 40 });
					await reloadReview(page);

					await page.waitForSelector(".rv-compose", { timeout: REVIEW_PAINT_MS });
					expect(await page.locator(".rv-compose__head").textContent()).toContain("a.ts:40");
					expect(await page.locator(".rv-compose__note").textContent()).toContain("was a.ts:19 — the diff moved");
					expect(await page.locator(".rv-compose__area").inputValue()).toBe("note typed on 19");

					// It saves without a reload: the write carries the page's rev, so the line it lands on is
					// the one the page drew, not the one the record was typed on.
					await page.locator(".rv-compose__acts .bf-btn--primary").click();
					await page.waitForSelector(".rv-thread", { timeout: REVIEW_PAINT_MS });
					expect(await page.locator(".rv-thread .bf-comment__body").textContent()).toBe("note typed on 19");
					expect(await page.locator(".rv-compose").count()).toBe(0);
				},
				{ start: 17 },
			);
		},
		CASE_MS,
	);

	/**
	 * A draft whose file the page no longer draws has nowhere to stand: it is listed above the diff
	 * with the word that says what it is, and only its reviewer's discard takes it away.
	 */
	test(
		"a draft for a file the page does not draw is listed, and only a discard clears it",
		async () => {
			await withPage(
				async (page, fixture) => {
					await page
						.locator('.rv-file[data-path="b.ts"] .bf-diff-line--add .browse-diff-no')
						.filter({ hasText: /^\d+$/ })
						.first()
						.click();
					await page.locator("#rv-sel-comment").click();
					await page.locator(".rv-compose__area").fill("note typed on b.ts");
					fixture.reshape({ start: 40 });
					await reloadReview(page);

					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).document.querySelector("#rv-orphans")?.hidden === false,
						undefined,
						{
							timeout: REVIEW_PAINT_MS,
						},
					);
					expect(await page.locator(".rv-compose").count()).toBe(0);
					expect(await page.locator(".rv-orphans__ref").textContent()).toBe("b.ts:42 · unsent");
					expect(await page.locator(".rv-orphans__body").textContent()).toBe("note typed on b.ts");
					expect(await page.locator(".rv-orphans__item .bf-btn").textContent()).toBe("discard");

					await page.locator(".rv-orphans__item .bf-btn").click();
					await page.waitForFunction(
						() => (globalThis as unknown as ReviewDom).document.querySelector("#rv-orphans")?.hidden === true,
						undefined,
						{
							timeout: REVIEW_PAINT_MS,
						},
					);
					await reloadReview(page);
					expect(await page.locator(".rv-compose").count()).toBe(0);
					expect(await page.locator("#rv-orphans").isVisible()).toBe(false);
				},
				{ start: 17, second: true },
			);
		},
		CASE_MS,
	);
});
