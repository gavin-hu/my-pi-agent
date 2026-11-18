/**
 * The card dialog's head, measured the way a layout defect has to be.
 *
 * Split from `dialog-behaviour.test.ts`, which is at its line budget, and from `run-row-behaviour`;
 * the question is its own: the head is one flex line, and whether the title gets the row depends on
 * arithmetic no rule can be read for. A declaration can be right while the row is still short — a
 * spacer creeping back into the markup, a narrower panel, a meta that grows a field — so the case
 * measures the boxes instead of the stylesheet.
 *
 * It needs a browser; where the machine has none it skips, naming `PI_CHROME`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import {
	BOARD_CHROME as CHROME,
	BOARD_PAINT_MS as PAINT_MS,
	type BoardBrowser,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";
import type { ElementLike } from "../../../test/helpers/board-dom.ts";
import { LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import { makeClock } from "../../../test/helpers/clock.ts";

/** A fixed clock: the page prints ages, and a test that read the wall clock would drift. */
const clock = makeClock(1_760_000_000_000);

/** The board the suite reads. */
let board: BoardBrowser;

/** The suite's one tab, its document reloaded for each case. */
const openPage = (): Promise<Page> => board.reuse();

/**
 * The meta drawn wider than this machine's font draws it, standing in for another family.
 *
 * The head's five spans are nowrap text with no floor of their own, so the font that draws them is
 * the one that used to decide how much of the row the title got: `--font-ui` leads with the macOS
 * family, and the same page on Linux took the title below half. Scaling the type is that wider
 * font, at a size every machine agrees on.
 */
const WIDER_META =
	"#card-dialog-id,#card-dialog-kind,#card-dialog-owner,#card-dialog-priority,#card-dialog-state{font-size:1.6em}";

/** One box, in the page's own coordinates. */
interface Box {
	clientWidth: number;
	scrollWidth: number;
	left: number;
	right: number;
}

/**
 * The title's box and the panel's corner, read in the page.
 *
 * Two boxes and not a style: the title can be told to grow and still be drawn short, and a close
 * that exists can still be drawn outside the panel it belongs to.
 */
const BOXES = (): { title: Box; close: Box; panel: Box; head: Box; content: number } => {
	const doc = globalThis as unknown as {
		document: { querySelector(selector: string): ElementLike | null };
		getComputedStyle(node: ElementLike): { paddingLeft: string; paddingRight: string };
	};
	const box = (selector: string): Box => {
		const node = doc.document.querySelector(selector) as unknown as {
			clientWidth: number;
			scrollWidth: number;
			getBoundingClientRect(): { left: number; right: number };
		} | null;
		if (node === null) throw new Error(`no ${selector} to measure`);
		const rect = node.getBoundingClientRect();
		return { clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, left: rect.left, right: rect.right };
	};
	// The row the title is meant to own: the head's content box, its own padding taken out. The
	// threshold below is a share of this, so it travels with the panel's width and the head's spacing.
	const head = doc.document.querySelector(".board-dialog__head") as unknown as {
		clientWidth: number;
	} | null;
	if (head === null) throw new Error("no .board-dialog__head to measure");
	const style = doc.getComputedStyle(head as unknown as ElementLike);
	return {
		title: box("#card-dialog-title"),
		close: box("#card-dialog-close"),
		panel: box(".board-dialog__panel"),
		head: box(".board-dialog__head"),
		content: head.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
	};
};

describe.skipIf(CHROME === undefined)("the card dialog's head", () => {
	beforeAll(async () => {
		board = await openBoardBrowser({
			lead: LEAD.label,
			now: clock.now,
			seed: seedWorkingBoard,
			display: { repo: "my-pi-agent", root: "/Users/someone/my-pi-agent", where: "~/.pi/agent/board/head" },
		});
	}, 30_000);

	afterAll(async () => {
		await board?.close();
	}, 30_000);

	test("gives the title the row, and keeps the close inside the panel at both widths", async () => {
		const page = await openPage();
		await page.click("#lane-execute .bf-row__title");
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });

		// At 1280 the title's box is most of the head's row. The share, not a pixel count: the old
		// head's spacer grew first and left the title its 12ch basis, about a quarter of the row, so
		// half is the line between "the title owns the row" and "something else grew first" — and a
		// share travels with the panel, the padding and the meta, where 400px did not.
		const wide = await page.evaluate(BOXES);
		expect(wide.title.clientWidth * 2).toBeGreaterThanOrEqual(wide.content);
		// And the title does not overflow its own box: a width assertion alone passes on a title drawn
		// past the column it was given, which is the clipped-row lesson one row up.
		expect(wide.title.scrollWidth).toBeLessThanOrEqual(wide.title.clientWidth);
		// The close is a box, not a presence: the first attempt at pinning it drew the button outside the
		// panel entirely, and "the element exists" was true the whole time it was gone.
		expect(wide.close.right).toBeLessThanOrEqual(wide.panel.right);
		expect(wide.close.left).toBeGreaterThanOrEqual(wide.panel.left);

		// At 620 the meta has to wrap under the title; the title still may not clip, and the pinned
		// close still belongs to the panel rather than to the row it just stopped sharing.
		await page.setViewportSize({ width: 620, height: 900 });
		// A wait for the resize itself, not a sleep: the panel is `min(720px,100%)`, so it only narrows
		// once the new viewport has been laid out, and the head's reflow is what changed with it.
		await page.waitForFunction(
			(previous) => {
				const doc = globalThis as unknown as {
					document: { querySelector(selector: string): { clientWidth: number } | null };
				};
				const panel = doc.document.querySelector(".board-dialog__panel");
				return panel !== null && panel.clientWidth < previous;
			},
			wide.panel.clientWidth,
			{ timeout: PAINT_MS },
		);
		const narrow = await page.evaluate(BOXES);
		expect(narrow.title.scrollWidth).toBeLessThanOrEqual(narrow.title.clientWidth);
		expect(narrow.close.right).toBeLessThanOrEqual(narrow.panel.right);
		expect(narrow.close.left).toBeGreaterThanOrEqual(narrow.panel.left);
	});

	test("keeps the title's half of the row when the meta is drawn wider", async () => {
		// The case above reads this machine's font — the family the head was tuned on — and its 620
		// half proves the narrow no-clip rather than a second share. This is the wide-font proof: the
		// meta asks for more room than the row has, as the Linux and Windows families did, so the
		// title's half has to come from the floor rather than from the font, and the meta wraps under
		// it instead of being cut. Nothing clips — not the title, and not the head the meta grew.
		const page = await openPage();
		await page.addStyleTag({ content: WIDER_META });
		await page.click("#lane-execute .bf-row__title");
		await page.waitForSelector("#board-card-dialog:not([hidden])", { timeout: PAINT_MS });
		const wide = await page.evaluate(BOXES);
		expect(wide.title.clientWidth * 2).toBeGreaterThanOrEqual(wide.content);
		expect(wide.title.scrollWidth).toBeLessThanOrEqual(wide.title.clientWidth);
		expect(wide.head.scrollWidth).toBeLessThanOrEqual(wide.head.clientWidth);
	});
});
