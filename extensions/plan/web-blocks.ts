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
 * reader pressing either key on a fresh page expects. A view can hide blocks, and a
 * hidden block is not a place the reader can be sent: the step lands on the next block
 * they can actually see, or nowhere when the filter left none.
 */
export function moveActive(planEl: ClientNode | null, activeIndex: number, delta: number): number | null {
	const blocks = blockElements(planEl);
	if (blocks.length === 0) return null;
	const step = delta < 0 ? -1 : 1;
	const first =
		activeIndex < 0 ? (step < 0 ? blocks.length - 1 : 0) : Math.min(Math.max(activeIndex + step, 0), blocks.length - 1);
	for (let index = first; index >= 0 && index < blocks.length; index += step) {
		if (blocks[index]?.hidden !== true) return setActive(planEl, index);
	}
	return null;
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
/**
 * Keep the blocks a view asks for, and hide the rest.
 *
 * A view is a filter over what is drawn, not a second document: `All` restores every
 * block, so the reader is one click from the whole plan, and the page's status line says
 * how many were hidden so a filtered document never reads as a short one. Headings stay
 * in every view — a paragraph without its section is a sentence without a subject — and a
 * view with nothing to show keeps the document whole rather than blanking it. A comment
 * thread is hidden with the block it hangs under: a note with no text it refers to reads
 * as a comment on whatever happens to be above it.
 */
export function applyView(planEl: ClientNode | null, view: ReviewView): ViewCounts {
	if (!planEl) return { shown: 0, hidden: 0 };
	const blocks = blockElements(planEl);
	const keep = (block: ClientNode): boolean =>
		view === "all" ||
		block.getAttribute("data-kind") === "heading" ||
		(view === "changed"
			? block.getAttribute("data-changed") === "1"
			: (block.className || "").split(" ").indexOf("bf-block--commented") >= 0);
	// A filter that matches nothing but the headings is not a view of the plan: showing an
	// empty page is worse than showing the whole document beside the count.
	const matched = blocks.filter((block) => block.getAttribute("data-kind") !== "heading" && keep(block)).length;
	const whole = view !== "all" && blocks.length > 0 && matched === 0;
	const visible: Record<string, boolean> = {};
	for (const block of blocks) {
		block.hidden = !whole && !keep(block);
		if (!block.hidden) visible[block.getAttribute("data-line") ?? ""] = true;
	}
	const threads = planEl.querySelectorAll(".bf-comments");
	for (let i = 0; i < threads.length; i++) {
		const thread = threads[i];
		if (!thread) continue;
		const line = thread.getAttribute("data-line");
		if (line !== null) thread.hidden = visible[line] !== true;
	}
	const shown = whole ? blocks.length : blocks.filter(keep).length;
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
