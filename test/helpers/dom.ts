/**
 * The DOM a suite reads the shipped page through.
 *
 * This project's TypeScript has no DOM lib — the client is a string, so nothing here ever
 * compiled against one — and a predicate handed to Playwright is serialized into the page, so
 * it cannot close over a helper either. What it can do is reach the document through one
 * declared shape: a suite that asserted against a second copy of it would pass while the page
 * changed, which is why the declaration lives here and nowhere else.
 *
 * `board-dom.ts` and `plan-browser.ts` re-export it, so a suite imports the helper it already
 * uses and the owner stays one. `review-browser.ts`'s `ReviewDom` is deliberately not this
 * shape: it is a view of `globalThis` — document, `location.hash` and `getComputedStyle` — for
 * a suite that proves a stylesheet and a restored place, and no predicate here reads those.
 */

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
