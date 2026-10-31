/**
 * The DOM a board suite reads the shipped page through.
 *
 * This project's TypeScript has no DOM lib — the client is a string, so nothing here ever
 * compiled against one — and a predicate handed to Playwright is serialized into the page, so
 * it cannot close over a helper either. The suites that read a card's dialog and the board
 * behind it share these reads rather than each declaring a copy: the page has one shape, so a
 * suite asserting against a second one would pass while the page changed.
 */

import type { Page } from "playwright-core";

/**
 * The sliver of the document a predicate reads, reached by name inside its own body.
 */
export interface Doc {
	querySelector(selector: string): ElementLike | null;
	querySelectorAll(selector: string): ArrayLike<ElementLike>;
	getElementById(id: string): ElementLike | null;
	/** What the tab strip shows: the page's own name, once a frame has painted it. */
	title: string;
}

export interface ElementLike {
	textContent: string | null;
	hidden: boolean;
	/** The box a child can overflow: a card whose content spills has the larger scroll width. */
	scrollWidth: number;
	clientWidth: number;
	getAttribute(name: string): string | null;
	/** The last child of the meta's notes chip: the age the ticker rewrites. */
	lastElementChild: ElementLike | null;
}

/** Whether an element the page hides with the `hidden` attribute is hidden. */
export async function hidden(page: Page, selector: string): Promise<boolean> {
	return page.$eval(selector, (node) => (node as unknown as ElementLike).hidden);
}

/**
 * The id and class of whatever has focus.
 *
 * The trap moves focus itself, so asserting where it landed is the only way to see it:
 * a page can look modal while the keyboard is behind the scrim.
 */
export async function focusedId(page: Page): Promise<string> {
	return page.evaluate(
		() =>
			(
				globalThis as unknown as { document: { activeElement: ElementLike | null } }
			).document.activeElement?.getAttribute("id") ?? "",
	);
}

/** The class list of whatever has focus, when the element has no id of its own. */
export async function focusedClass(page: Page): Promise<string> {
	return page.evaluate(
		() =>
			(
				globalThis as unknown as { document: { activeElement: ElementLike | null } }
			).document.activeElement?.getAttribute("class") ?? "",
	);
}
