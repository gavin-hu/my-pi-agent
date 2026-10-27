/**
 * The review page's block navigation: which block is active, and how a key walks them.
 *
 * The fourth capability out of the review client's template literal. Each function takes
 * the document it reads and returns the index it computed, so the client keeps the one
 * variable (`activeIndex`) and these own the rules: clamp to the blocks that exist, start
 * at the first or last when nothing is active, and land beside the reader rather than
 * jumping to the middle of the page.
 *
 * `el` comes from the runtime, declared here because this source is spliced into the same
 * bundle; the declaration emits nothing.
 */

import type { ClientNode } from "../../lib/web/client-runtime.ts";

/** The island's view of one block, as far as navigation needs it. */
export interface IslandBlock {
	start: number;
	kind?: string;
}

/**
 * The rendered blocks.
 *
 * A rebuild replaces them, so this is read fresh rather than remembered: the array a
 * caller holds goes stale the moment `renderPlan` throws the DOM away.
 */
export function blockElements(planEl: ClientNode | null): ClientNode[] {
	if (!planEl) return [];
	const nodes = planEl.querySelectorAll(".bf-block");
	const blocks: ClientNode[] = [];
	for (let i = 0; i < nodes.length; i++) {
		const block = nodes[i];
		if (block) blocks.push(block);
	}
	return blocks;
}

/**
 * Make one block active and bring it into view, or say nothing when there are no blocks.
 *
 * `null` means "nothing changed": a page with no blocks has no active block, and the
 * caller keeps the index it had rather than being reset to zero.
 */
export function setActive(planEl: ClientNode | null, index: number): number | null {
	const blocks = blockElements(planEl);
	if (blocks.length === 0) return null;
	const next = Math.max(0, Math.min(blocks.length - 1, index));
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		if (block) block.classList.toggle("bf-block--active", i === next);
	}
	const current = blocks[next];
	if (current && current.scrollIntoView) current.scrollIntoView({ block: "nearest" });
	return next;
}

/**
 * The index one step from `activeIndex`, or `null` when there is nothing to walk.
 *
 * With nothing active yet, `j` starts at the top and `k` at the bottom, which is what a
 * reader pressing either key on a fresh page expects.
 */
export function moveActive(planEl: ClientNode | null, activeIndex: number, delta: number): number | null {
	const blocks = blockElements(planEl);
	if (blocks.length === 0) return null;
	const next = activeIndex < 0 ? (delta < 0 ? blocks.length - 1 : 0) : activeIndex + delta;
	return setActive(planEl, next);
}

/**
 * The rendered block and its island block for a source line, when both exist.
 *
 * Both halves are required: a rendered block with no island entry has nothing to comment
 * on, and an island entry with no rendered block is a comment the page cannot place.
 */
export function blockAtLine(
	planEl: ClientNode | null,
	blocks: readonly IslandBlock[],
	line: number,
): { wrap: ClientNode; block: IslandBlock } | null {
	const wrap = planEl ? planEl.querySelector('.bf-block[data-line="' + line + '"]') : null;
	let block: IslandBlock | undefined;
	for (const candidate of blocks) if (candidate.start === line) block = candidate;
	return wrap && block ? { wrap, block } : null;
}

/** What the reader asked the plan to show. */
export type ReviewView = "all" | "changed" | "comments";

/** How much of the plan a view kept, so the page can say what it is hiding. */
export interface ViewCounts {
	shown: number;
	hidden: number;
}

/**
 * Keep the blocks a view asks for, and hide the rest.
 *
 * A view is a filter over what is drawn, not a second document: `All` restores every
 * block, so the reader is one click from the whole plan, and the page's status line says
 * how many were hidden so a filtered document never reads as a short one. Headings stay
 * in every view — a paragraph without its section is a sentence without a subject — and a
 * view with nothing to show keeps the document whole rather than blanking it.
 */
export function applyView(planEl: ClientNode | null, view: ReviewView): ViewCounts {
	const blocks = blockElements(planEl);
	if (!planEl) return { shown: 0, hidden: 0 };
	if (view === "all") {
		for (const block of blocks) block.hidden = false;
		return { shown: blocks.length, hidden: 0 };
	}
	let shown = 0;
	for (const block of blocks) {
		const keep =
			block.getAttribute("data-kind") === "heading" ||
			(view === "changed"
				? block.getAttribute("data-changed") === "1"
				: (block.className || "").split(" ").indexOf("bf-block--commented") >= 0);
		block.hidden = !keep;
		if (keep) shown += 1;
	}
	// A filter that matches nothing is not a view of the plan: showing an empty page is
	// worse than showing the whole document beside the count.
	if (shown === blocks.length) return { shown, hidden: 0 };
	if (blocks.length > 0 && shown === blocks.filter((block) => block.getAttribute("data-kind") === "heading").length) {
		for (const block of blocks) block.hidden = false;
		return { shown: blocks.length, hidden: 0 };
	}
	return { shown, hidden: blocks.length - shown };
}

/**
 * The block rules as source, for the client bundle.
 *
 * `applyView` travels with them because the page's view control calls it on every render:
 * a name the bundle does not carry is a `ReferenceError` at the first repaint, which
 * aborts the boot before the composer and the progress bar are wired.
 */
export const WEB_BLOCKS_JS = [blockElements, setActive, moveActive, blockAtLine, applyView].map(String).join("\n\n");
