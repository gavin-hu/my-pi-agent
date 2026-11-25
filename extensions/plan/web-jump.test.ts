/**
 * The arrival a section jump owes the reader: the block takes the keyboard, the pane keeps the
 * scroll the link gave it, and the outline's mark still names the section.
 *
 * Three facts, not one. A case that only asserted `document.activeElement` would pass while the
 * mark went stale by the other road: the scroll pass reads where the pane sits, so a focus that
 * scrolled would hand it the wrong section — which is why the real pass is compared against one
 * whose focus is stubbed out, on a page tall enough for the difference to exist.
 *
 * Where the machine has no browser the second suite skips, naming `PI_CHROME`, so `bun run check`
 * stays green there and still says why nothing ran.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import type { TestBrowser } from "../../test/helpers/browser.ts";
import {
	launchReviewBrowser,
	mountReview,
	openReview,
	REVIEW_CHROME,
	REVIEW_PAGE,
	REVIEW_PAINT_MS,
} from "../../test/helpers/plan-browser.ts";
import { shippedRenderOutline } from "../../test/helpers/fixtures/plan-web.ts";
import type { ClientNode } from "../../lib/web/client-runtime.ts";
import { focusSection } from "./web-jump.ts";

const ENTRIES = [
	{ id: "s-1", level: 1, line: 1, text: "Goal" },
	{ id: "s-8", level: 2, line: 8, text: "Steps", changed: true },
	{ id: "s-20", level: 1, line: 20, text: "Risks" },
];

describe("the outline's arrival hook", () => {
	test("calls the hook with the section a jump named, and marks it first", () => {
		// A link scrolls the pane and nothing more, so the page hands the list a hook that puts the
		// keyboard on the block: the mark moves first, then the arrival is announced.
		const dom = shippedRenderOutline();
		const list = dom.build("ul");
		const jumped: string[] = [];
		dom.renderOutline(list as unknown as ClientNode, ENTRIES, (id) => jumped.push(id));
		const second = list.children[1]?.children[0];
		expect(second, "the outline draws one link per heading").toBeDefined();
		second?.click();
		expect(jumped).toEqual(["s-8"]);
		expect(dom.markedId(list)).toBe("s-8");
	});

	test("builds without a hook, which is the shape a caller with no plan frame passes", () => {
		// Session mail and the narrow band render this list too, through paths that have no block
		// to focus: a jump there must still mark the section, and never throw.
		const dom = shippedRenderOutline();
		const list = dom.build("ul");
		dom.renderOutline(list as unknown as ClientNode, ENTRIES);
		const first = list.children[0]?.children[0];
		expect(first, "the outline draws one link per heading").toBeDefined();
		expect(() => first?.click()).not.toThrow();
		expect(dom.markedId(list)).toBe("s-1");
	});
});

describe("the block a jump lands on", () => {
	/** A block double: the three members the rule reads, recording the focus it was given. */
	function block(): {
		node: Record<string, unknown>;
		attributes: Map<string, string>;
		calls: Array<{ preventScroll?: boolean }>;
	} {
		const attributes = new Map<string, string>();
		const calls: Array<{ preventScroll?: boolean }> = [];
		return {
			attributes,
			calls,
			node: {
				getAttribute: (name: string) => attributes.get(name) ?? null,
				setAttribute: (name: string, value: string) => attributes.set(name, value),
				focus: (options?: { preventScroll?: boolean }) => calls.push(options ?? {}),
			},
		};
	}

	test("becomes a focus target, and takes focus without scrolling the pane", () => {
		const target = block();
		const planEl = { querySelector: (selector: string) => (selector === "#s-8" ? target.node : null) };
		focusSection(planEl as unknown as ClientNode, "s-8");
		// `tabindex="-1"` is no tab stop, so the sequential point the reader had is unchanged.
		expect(target.attributes.get("tabindex")).toBe("-1");
		expect(target.calls).toEqual([{ preventScroll: true }]);
	});

	test("keeps a tabindex the block already has, and does nothing for an id it cannot find", () => {
		const target = block();
		target.attributes.set("tabindex", "0");
		const planEl = { querySelector: () => target.node };
		focusSection(planEl as unknown as ClientNode, "s-8");
		expect(target.attributes.get("tabindex")).toBe("0");
		expect(target.calls).toHaveLength(1);
		// A heading that moved has a new id, and a jump to the old one lands nowhere rather than throw.
		expect(() => focusSection({ querySelector: () => null } as unknown as ClientNode, "s-404")).not.toThrow();
		expect(() => focusSection(null, "s-404")).not.toThrow();
	});
});

describe.skipIf(REVIEW_CHROME === undefined)("the served review's jump", () => {
	let browser: TestBrowser;
	let reviewUrl = "";
	let closeReview: () => Promise<void> = async () => {};

	beforeAll(async () => {
		const started = await mountReview(REVIEW_PAGE);
		reviewUrl = started.url;
		closeReview = started.close;
		browser = await launchReviewBrowser();
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
		await closeReview();
	}, 30_000);

	/** The pane's scroll position, which is the box a jump moves. */
	const paneTop = (page: Page): Promise<number> =>
		page.$eval("#plan", (node) => (node as unknown as { scrollTop: number }).scrollTop);

	test("marks the section, and puts the keyboard on it", async () => {
		const page = await openReview(browser, reviewUrl);
		try {
			const links = page.locator("#outline-list a");
			expect(await links.count()).toBe(2);
			await links.nth(1).click();
			// The arrival: a link scrolls the pane and leaves focus where it was, so the client puts
			// the keyboard on the block it named — the fact a screen reader reads as the section.
			await page.waitForFunction(
				() =>
					(globalThis as unknown as { document: { activeElement: { id: string } | null } }).document.activeElement
						?.id === "s-3",
				undefined,
				{ timeout: REVIEW_PAINT_MS },
			);
			// And the mark still names it after the focus arrives: a focus that scrolled the pane
			// would move the reading line and leave the previous section marked.
			await page.waitForFunction(
				() =>
					(
						globalThis as unknown as {
							document: { querySelector: (selector: string) => { textContent: string | null } | null };
						}
					).document
						.querySelector('#outline-list a[aria-current="true"]')
						?.textContent?.includes("Rollout") ?? false,
				undefined,
				{ timeout: REVIEW_PAINT_MS },
			);
		} finally {
		}
	});

	test("announces the jump without scrolling the pane a second time", async () => {
		// The page has to be tall enough to scroll, or "the pane did not move" is true of a pane
		// that cannot: with the browser's own focus stubbed out, the pane lands where the link put
		// it, and the real page must land in the same place.
		const tall = await mountReview({
			...REVIEW_PAGE,
			blocks: [
				{ start: 0, end: 0, kind: "heading", lines: ["# Add rate limiting"], level: 1, text: "Add rate limiting" },
				...Array.from({ length: 12 }, (_unused, i) => ({
					start: i + 1,
					end: i + 1,
					kind: "paragraph" as const,
					lines: [
						`Start with the token bucket, one bucket per client and one refill per second: ${i}.`,
						`A refusal names the wait, so a client backs off instead of retrying into the same wall: ${i}.`,
					],
				})),
				{ start: 20, end: 20, kind: "heading", lines: ["## Rollout"], level: 2, text: "Rollout" },
				...Array.from({ length: 4 }, (_unused, i) => ({
					start: 21 + i,
					end: 21 + i,
					kind: "paragraph" as const,
					lines: [`Ship behind a flag, and widen it one gateway at a time: ${i}.`],
				})),
			],
			outline: [
				{ id: "s-0", line: 0, level: 1, text: "Add rate limiting" },
				{ id: "s-20", line: 20, level: 2, text: "Rollout" },
			],
		});
		try {
			const suppressed = await openReview(browser, tall.url);
			let anchorOnly = 0;
			try {
				await suppressed.evaluate(() => {
					const win = globalThis as unknown as {
						HTMLElement: { prototype: { focus: (this: unknown, options?: unknown) => void } };
						__focusCalls: Array<{ id: string; preventScroll: boolean }>;
					};
					win.__focusCalls = [];
					win.HTMLElement.prototype.focus = function (this: unknown, options?: unknown): void {
						const node = this as { id: string };
						win.__focusCalls.push({
							id: node.id,
							preventScroll: (options as { preventScroll?: boolean } | undefined)?.preventScroll === true,
						});
					};
				});
				await suppressed.locator("#outline-list a").nth(1).click();
				const calls = await suppressed.evaluate(
					() => (globalThis as unknown as { __focusCalls: Array<{ id: string; preventScroll: boolean }> }).__focusCalls,
				);
				expect(calls).toEqual([{ id: "s-20", preventScroll: true }]);
				anchorOnly = await paneTop(suppressed);
				expect(anchorOnly, "the page must be tall enough for the jump to scroll it").toBeGreaterThan(0);
			} finally {
				await suppressed.close();
			}

			const real = await openReview(browser, tall.url);
			try {
				await real.locator("#outline-list a").nth(1).click();
				await real.waitForFunction(
					() =>
						(globalThis as unknown as { document: { activeElement: { id: string } | null } }).document.activeElement
							?.id === "s-20",
					undefined,
					{ timeout: REVIEW_PAINT_MS },
				);
				expect(await paneTop(real)).toBe(anchorOnly);
			} finally {
				await real.close();
			}
		} finally {
			await tall.close();
		}
	});
});
