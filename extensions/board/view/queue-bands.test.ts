/**
 * The Needs you queue's column and its rows, measured in the browser.
 *
 * `team.test.ts` holds the tab's own contracts and is named at its height in
 * `test/suite-sizes.test.ts`, so the queue's geometry lives here rather than growing a suite that
 * may not gain a line. Everything here is a computed layout: one column of bands at every width, a
 * band head drawn even at 0, a title that reads whole on its own line, the facts under it, and a
 * reason bounded to two of them.
 *
 * Both sides of a comparison come off the page — the queue's content box, a band's box, a row's
 * computed height, the line rects a clamped reason draws — so a case cannot pass while the layout
 * drifts under a number written here.
 *
 * It needs a browser. Where the machine has none the suite skips, naming `PI_CHROME`, so
 * `bun run check` stays green on a runner without Chrome and still says why nothing ran.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { type Doc } from "../../../test/helpers/board-dom.ts";
import { LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import {
	BOARD_CHROME as CHROME,
	BOARD_PAINT_MS as PAINT_MS,
	type BoardBrowser,
	drawn,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";
import { makeClock } from "../../../test/helpers/clock.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/** How long a suite's hooks may take: two boots, and a teardown that closes each browser. */
const HOOK_MS = 30_000;

/** A sliver of the elements a case measures; this project's TypeScript has no DOM lib. */
interface Boxed {
	getBoundingClientRect(): { top: number; width: number; height: number };
	textContent: string | null;
	scrollWidth?: number;
	clientWidth?: number;
	clientHeight: number;
	getAttribute?(name: string): string | null;
	title?: string;
}

/** Poll until `ready` holds, so a case waits on the page rather than on a fixed sleep. */
async function waitFor(ready: () => Promise<boolean>, timeout: number): Promise<void> {
	const until = Date.now() + timeout;
	while (Date.now() < until) {
		if (await ready()) return;
		await Bun.sleep(50);
	}
	throw new Error("the page did not reach the state the case waits for");
}

/** Each band as drawn: its label, the count in its head, the rows it drew, and its fold. */
async function bands(page: Page): Promise<Array<{ label: string; count: number; rows: number; fold: string }>> {
	return page.$$eval("#board-team .board-queue__band", (nodes) =>
		Array.from(nodes as ArrayLike<Boxed>, (band) => ({
			label: band.querySelector("span")?.textContent ?? "",
			count: Number(band.querySelector(".bf-lane__count")?.textContent ?? ""),
			rows: band.querySelectorAll(".board-queue__row").length,
			fold: (band.querySelector(".board-fold")?.textContent ?? "").trim(),
		})),
	);
}

/** How far a band's head sits below the pane head's box — the pin offset, read as drawn. */
const headGap = (page: Page, label: string) =>
	page.evaluate((name: string) => {
		const document = (globalThis as unknown as { document: Doc }).document;
		const pane = document.querySelector('[data-pane="needs-you"] .bf-section__cap') as unknown as Boxed | null;
		const band = Array.from(document.querySelectorAll("#board-team .board-queue__band"))
			.map((node) => node as unknown as Boxed)
			.find((node) => (node.querySelector("span")?.textContent ?? "") === name);
		const head = band?.querySelector(".bf-lane__head") as unknown as Boxed | null;
		if (pane === null || head === null) throw new Error(`${name}'s head is not on the page`);
		const box = pane.getBoundingClientRect();
		return Math.round((head.getBoundingClientRect().top - box.top - box.height) * 10) / 10;
	}, label);

/** The three band labels, in the order the column draws them. */
const BANDS = ["Your signature", "Unclaimed", "Stalled"];

let board: BoardBrowser;

describe.skipIf(CHROME === undefined)("the Needs you column", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({ lead: LEAD.label, now: clock.now, seed: seedWorkingBoard });
	}, HOOK_MS);

	afterAll(async () => {
		await board?.close();
	}, HOOK_MS);

	test("stacks every band in one column, and gives each the whole of it", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .board-queue__band", { timeout: PAINT_MS });
		for (const width of [1280, 1440, 2560]) {
			await page.setViewportSize({ width, height: 900 });
			await drawn(page);
			const layout = await page.evaluate(() => {
				const document = (globalThis as unknown as { document: Doc }).document;
				const computed = (
					globalThis as unknown as { getComputedStyle(node: unknown): { paddingLeft: string; paddingRight: string } }
				).getComputedStyle;
				const queue = document.querySelector("#board-team .board-queue") as unknown as Boxed & {
					clientWidth: number;
				};
				const style = computed(queue);
				return {
					content: queue.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight),
					bands: Array.from(document.querySelectorAll("#board-team .board-queue__band"), (node) => node as unknown as Boxed).map(
						(band) => ({ top: Math.round(band.getBoundingClientRect().top), width: band.getBoundingClientRect().width }),
					),
				};
			});
			// One band per line, at a 2K window as much as at 1280: the column is the queue's shape,
			// not a function of the width.
			expect(new Set(layout.bands.map((band) => band.top)).size, `width ${width}`).toBe(layout.bands.length);
			for (const band of layout.bands) {
				// Each band fills the column to the browser's sub-pixel rounding — a band that kept a
				// track of its own, or a cap, leaves the pane short of itself.
				expect(Math.abs(band.width - layout.content), `width ${width}`).toBeLessThanOrEqual(1);
			}
		}
	});

	test("draws every band, a head with no asks included", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .board-queue__band", { timeout: PAINT_MS });
		// A filter that matches nothing empties all three bands at once, which is the state the
		// always-drawn rule exists for: the sections are still the column's shape.
		await page.fill("#board-filter", "no card answers to this");
		await waitFor(async () => (await bands(page)).every((band) => band.count === 0), PAINT_MS);
		const drawnBands = await bands(page);
		expect(drawnBands.map((band) => band.label)).toEqual(BANDS);
		expect(drawnBands.map((band) => band.count)).toEqual([0, 0, 0]);
		expect(drawnBands.map((band) => band.rows)).toEqual([0, 0, 0]);
	});

	test("pins a band's head while its own band is under the pane", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		for (let index = 0; index < 10; index++) {
			await board.store.create({ title: `Pin item ${index + 1}`, paths: ["src/pin"] }, LEAD, clock.now() - index * 1_000);
		}
		await waitFor(async () => (await bands(page)).some((band) => band.label === "Unclaimed" && band.count === 12), PAINT_MS);
		// A short window gives the column room to scroll past the pane's head: at the suite's own
		// height the page cannot scroll far enough for any band to pin.
		await page.setViewportSize({ width: 1280, height: 420 });
		await drawn(page);
		// Scroll inside the claim band, not by a fixed number: a head pins only while its band is
		// under the pane, and a taller row made a fixed 400 px carry the whole band past it.
		const scrolled = await page.evaluate(() => {
			const document = (globalThis as unknown as { document: Doc }).document;
			const main = document.querySelector(".bf-app__main") as unknown as {
				scrollTop: number;
				getBoundingClientRect(): { top: number };
			};
			const band = Array.from(document.querySelectorAll("#board-team .board-queue__band"))
				.map((node) => node as unknown as Boxed)
				.find((node) => (node.querySelector("span")?.textContent ?? "") === "Unclaimed");
			if (band === undefined) throw new Error("the claim band is not on the page");
			main.scrollTop = Math.round(band.getBoundingClientRect().top - main.getBoundingClientRect().top + 80);
			return main.scrollTop;
		});
		expect(scrolled).toBeGreaterThan(0);
		await page.evaluate(
			"new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); })",
		);
		// Pinned under the pane head's own box: the head did not scroll away with its rows.
		expect(await headGap(page, "Unclaimed")).toBeGreaterThanOrEqual(0);
		expect(await headGap(page, "Unclaimed")).toBeLessThanOrEqual(8);
	});
});

/** The two titles the queue's own cards carry, at the lengths #773 measured, plus a wait chain. */
const LONG_62 = "A plan store keeps a bounded set of plans and sweeps the dupes";
const LONG_80 = "The board survives two machines: guarded writes, host-aware claims, and one lock";
const LONG_84 = "One registry names every path this package writes, and both stores become owner-only";
const LONG_90 = "Per-repository state moves under a synced repos/<repoId> and .pi keeps no state here";

/** What the row suite seeds wrote, so its cases can name the cards by id. */
const seeded = { titles: [] as string[], waits: "" };

/** The fixture plus four long-titled asks and one that waits on all of them. */
async function seedRows(store: Parameters<typeof seedWorkingBoard>[0], now: number): Promise<void> {
	await seedWorkingBoard(store, now);
	const ids: string[] = [];
	for (const [index, title] of [LONG_62, LONG_80, LONG_84, LONG_90].entries()) {
		const card = await store.create({ title, paths: ["src/rows"] }, LEAD, now - index * 1_000);
		ids.push(card.id);
	}
	const waits = await store.create({ title: "Row fixture that waits", paths: ["src/rows"] }, LEAD, now);
	await store.mutate(
		waits.id,
		{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: ids },
		LEAD,
		now,
	);
	seeded.titles = ids;
	seeded.waits = waits.id;
}

let rowsBoard: BoardBrowser;

describe.skipIf(CHROME === undefined)("the Needs you rows", () => {
	beforeAll(async () => {
		rowsBoard = await openBoardBrowser({ lead: LEAD.label, now: clock.now, seed: seedRows });
	}, HOOK_MS);

	afterAll(async () => {
		await rowsBoard?.close();
	}, HOOK_MS);

	/** Open the claim band's fold, so every seeded row is drawn: a folded band draws five. */
	async function openClaim(page: Page): Promise<void> {
		const fold = "#board-team [data-fold=\"team-band-claim\"]";
		if ((await page.$(fold)) !== null) {
			await page.click(fold);
			await waitFor(async () => (await bands(page))[1]?.fold === "show fewer", PAINT_MS);
		}
		await drawn(page);
	}

	/** The height of one line of a reason, measured from the shortest reason the page draws. */
	const whyUnit = (page: Page) =>
		page.evaluate(() => {
			const document = (globalThis as unknown as { document: Doc }).document;
			const heights = Array.from(document.querySelectorAll("#board-team .board-queue__why"))
				.map((node) => node as unknown as Boxed)
				.map((node) => node.getBoundingClientRect().height)
				.sort((left, right) => left - right);
			if (heights.length === 0) throw new Error("no reason is on the page");
			return heights[0] as number;
		});

	/** The row's box, its title's box, its reason's box, and whether the reason is clamped. */
	const rowShape = (page: Page, card: string) =>
		page.evaluate((id: string) => {
			const document = (globalThis as unknown as { document: Doc }).document;
			const row = document.querySelector(`#board-team .board-queue__row[data-card="${id}"]`);
			if (row === null) throw new Error(`card ${id} is not in the queue`);
			const title = row.querySelector(".bf-row__title") as unknown as Boxed;
			const why = row.querySelector(".board-queue__why") as unknown as Boxed | null;
			return {
				row: row.getBoundingClientRect().height,
				titleCut: (title.scrollWidth ?? 0) > (title.clientWidth ?? 0) + 1,
				titleWrapped: title.getBoundingClientRect().height,
				why: why === null ? null : why.getBoundingClientRect().height,
				whyTitle: why === null ? "" : (why as unknown as { title: string }).title,
				describedBy: title.getAttribute("aria-describedby") ?? "",
				stamped: row.querySelector(".board-stamp") !== null,
				rank: (row.querySelector(".board-queue__rank")?.textContent ?? "").trim(),
			};
		}, card);

	test("reads the long titles whole at 1280 and 1440", async () => {
		const page = await rowsBoard.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .board-queue__row", { timeout: PAINT_MS });
		await openClaim(page);
		expect([LONG_62.length, LONG_80.length]).toEqual([62, 80]);
		for (const width of [1280, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			await drawn(page);
			for (const id of seeded.titles.slice(0, 2)) {
				const shape = await rowShape(page, id);
				expect(shape.titleCut, `card ${id} at ${width}`).toBe(false);
				// One line of title: the title line is the whole title, not the first line of a
				// wrapped paragraph.
				expect(shape.titleWrapped, `card ${id} at ${width}`).toBeLessThanOrEqual(24);
			}
		}
	});

	test("bounds a band-suppressed row to two lines, and a long reason to two clamped ones", async () => {
		const page = await rowsBoard.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .board-queue__row", { timeout: PAINT_MS });
		await openClaim(page);
		// A band that prints the sentence its rows share keeps their reasons off the rows: the facts
		// still have their line, which is the two-line row.
		const suppressed = await rowShape(page, seeded.titles[0] as string);
		expect(suppressed.why).toBeNull();
		expect(suppressed.row).toBeLessThanOrEqual(50);
		// The wait's chain of four titles is the 400-char reason: two lines of it, the whole sentence
		// on the hover and in the description, and three text lines at most.
		const long = await rowShape(page, seeded.waits);
		const unit = await whyUnit(page);
		expect(long.why ?? 0).toBeLessThanOrEqual(unit * 2 + 1);
		expect(long.row).toBeLessThanOrEqual(72);
		expect(long.whyTitle.length).toBeGreaterThan(300);
		expect(long.describedBy).not.toBe("");
		expect(long.stamped).toBe(false);
	});

	test("numbers the rows as drawn, and prints no age on a waiting row", async () => {
		const page = await rowsBoard.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .board-queue__row", { timeout: PAINT_MS });
		await openClaim(page);
		const ranks = await page.$$eval("#board-team .board-queue__row .board-queue__rank", (nodes) =>
			Array.from(nodes as ArrayLike<Boxed>, (node) => (node.textContent ?? "").trim()),
		);
		expect(ranks).toEqual(ranks.map((_rank, index) => String(index + 1)));
		expect((await rowShape(page, seeded.waits)).stamped).toBe(false);
	});

	test("gives a phone the whole title, wrapped rather than elided", async () => {
		const page = await rowsBoard.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .board-queue__row", { timeout: PAINT_MS });
		await openClaim(page);
		await page.setViewportSize({ width: 420, height: 900 });
		await drawn(page);
		const shape = await rowShape(page, seeded.titles[1] as string);
		expect(shape.titleCut).toBe(false);
		expect(shape.titleWrapped).toBeGreaterThan(24);
	});
});
