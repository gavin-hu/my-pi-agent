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
import type { ElementLike } from "./dom.ts";

/** The document's shape, declared once in `dom.ts` and re-exported so a board suite imports one helper. */
export type { Doc, ElementLike } from "./dom.ts";

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
