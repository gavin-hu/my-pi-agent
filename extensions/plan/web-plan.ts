/**
 * The review page's plan renderer: the DOM a frame draws, thrown away and rebuilt.
 *
 * The seventh capability out of the review client's template literal, and the one with the
 * most to read: it builds every block, its comment rail, and the cards under it, then puts
 * the reader back where they were. Reads arrive through getters and mutations leave through
 * callbacks, so the client keeps every variable it owns — `activeIndex`, the quote a click
 * is waiting for, the observer — and this function holds only the shape of one frame.
 *
 * Three rules it owns, all about a repaint not stealing the reader's place:
 *
 * - focus is restored only when it was inside the plan to begin with, so a frame the stream
 *   caused cannot pull the keyboard out of the page the reviewer is working in;
 * - a write names the card it changed, and the frame puts the tab stop there; a frame no
 *   write asked for keeps the old fallback, the block's control;
 * - the active block's class is put back in place rather than by scrolling, so the arrow
 *   keys resume where they were instead of jumping to the top.
 */

import { pageSource } from "../../lib/format.ts";
import type { ClientNode } from "../../lib/web/client-runtime.ts";
import type { ComposerDeps } from "./web-composer.ts";
import { blockElements, type IslandBlock, setActive } from "./web-blocks.ts";
import type { SectionWatch } from "./web-outline.ts";

/** What `el` has to answer for a frame. Spliced beside it; declared for the checker. */
type Build = (tag: string, className?: string, text?: string | null) => ClientNode;
declare const el: Build;

/** The quote a click on a block's control is waiting for: the reader's selection. */
export interface PendingQuote {
	wrap: ClientNode;
	quote: string;
}

/** What a repaint reads, and the callbacks it changes the client's state through. */
export interface PlanRenderDeps {
	planEl: ClientNode | null;
	outlineList: ClientNode | null;
	/** The element that had focus before this frame, or null when nothing did. */
	focused: ClientNode | null;
	blocks(): readonly IslandBlock[];
	/** Whether this block is new or edited since the previous review; absent means no marks. */
	changed?(line: number): boolean;
	annotations(): readonly { anchor: number }[];
	activeIndex(): number;
	setActiveIndex(index: number): void;
	pendingQuote(): PendingQuote | null;
	clearPendingQuote(): void;
	/** Whether the review has ended, so the rail offers no new comment. */
	settled?(): boolean;
	/**
	 * Whether this page may add a comment at all; absent means it may. A viewer's page has no
	 * composer and no route to send one, so its rail carries the count and no button.
	 */
	canComment?(): boolean;
	/** The composer lifecycle, for the close a repaint begins with. */
	composer(): ComposerDeps;
	/** The block's content, from the Markdown half. */
	renderBlock(wrap: ClientNode, block: IslandBlock): void;
	/** The cards under one block, and the loose ones that lost their anchor. */
	renderComments(scope: ClientNode, line: number, label: string): void;
	renderCommentCards(scope: ClientNode, list: readonly unknown[]): void;
	/** The text a reader selected inside a block, used as the next comment's quote. */
	selectionIn(wrap: ClientNode): string;
	open(wrap: ClientNode, block: IslandBlock, quote: string): void;
	/** The facts and the header chip, repainted after the blocks. */
	facts(): void;
	updateState(): void;
	/** The card a write wants focused after this frame, or null; read and cleared once. */
	focusAfter?(): { line: number; index: number } | null;
	clearFocusAfter?(): void;
}

/**
 * Draw the plan, and put the reader back. Returns the section watch it installed.
 *
 * The client's own zero-argument entry is `renderAll()`: it builds the frame's deps and
 * hands them here, which is how the fragments keep calling a name that takes nothing.
 */
export function renderPlanFrame(
	deps: PlanRenderDeps,
	closePlan: () => void,
	watch: (
		planEl: ClientNode | null,
		list: ClientNode | null,
		previous: SectionWatch | null,
	) => SectionWatch | null,
	previousWatch: SectionWatch | null,
): SectionWatch | null {
	const { planEl } = deps;
	if (!planEl) return previousWatch;
	// Focus is only put back when it was inside this document to begin with.
	const keepFocus = !!(deps.focused && deps.focused !== planEl && planEl.contains(deps.focused));
	closePlan();
	const scrollTop = planEl.scrollTop;
	planEl.replaceChildren();
	/**
	 * The block's own words, short enough to name the control beside it: a heading's text, else
	 * its first line that is not a fence, with list, quote, emphasis and code markers
	 * stripped. A block with no words falls back to "this block".
	 */
	const blockLabel = (block: IslandBlock): string => {
		const clean = (line: string): string =>
			line
				.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
				.replace(/[`#>*_~]/g, "")
				.replace(/\s+/g, " ")
				.trim();
		if (block.kind === "heading" && block.text) return clean(block.text).slice(0, 40) || "this block";
		for (const line of block.lines ?? []) {
			if (/^\s*(?:```|~~~)/.test(line)) continue;
			const text = clean(line);
			if (text) return text.slice(0, 40);
		}
		return "this block";
	};
	const anchored: Record<number, boolean> = {};
	const blocks = deps.blocks();
	// Whether the block after this one continues a run of items. A blank block draws nothing, so a
	// spaced list still reads one run; anything but another item ends it.
	function nextIsList(index: number): boolean {
		for (let next = index + 1; next < blocks.length; next++) {
			const block = blocks[next];
			if (block === undefined || block.kind === "blank") continue;
			return block.kind === "list";
		}
		return false;
	}
	for (let index = 0; index < blocks.length; index++) {
		const block = blocks[index];
		if (block === undefined || block.kind === "blank") continue;
		anchored[block.start] = true;
		const label = blockLabel(block);
		const wrap = el("div", "bf-block");
		wrap.setAttribute("data-line", String(block.start));
		wrap.setAttribute("data-kind", String(block.kind));
		// The one mark that says "read this line again": a block the last review did not have.
		if (deps.changed?.(block.start) === true) wrap.setAttribute("data-changed", "1");
		if (block.kind === "heading") wrap.id = "s-" + block.start;
		// The last item of a run is the one that keeps the kit's gap below a list: the items before
		// it sit flush, which is how one list drawn block by block still reads as one.
		if (block.kind === "list" && !nextIsList(index)) wrap.setAttribute("data-run-end", "1");
		deps.renderBlock(wrap, block);
		const mine = deps.annotations().filter((annotation) => annotation.anchor === block.start);
		if (mine.length > 0) wrap.classList.add("bf-block--commented");
		const rail = el("div", "bf-block__rail");
		// A settled review takes no new comment, and neither does a page that cannot write one:
		// this control would open a composer whose note could never be saved, so it is not drawn
		// rather than drawn and refused.
		if (deps.settled?.() !== true && deps.canComment?.() !== false) {
			const add = el("button", "bf-block__add");
			add.type = "button";
			add.textContent = "+";
			add.setAttribute("aria-label", "Comment on \u201c" + label + "\u201d");
			add.addEventListener("click", function () {
				// Read at click time, not at render time: a selection made after this frame is
				// the quote the reader means.
				const waiting = deps.pendingQuote();
				const quoted = waiting && waiting.wrap === wrap ? waiting.quote : deps.selectionIn(wrap);
				deps.clearPendingQuote();
				deps.open(wrap, block, quoted);
			});
			rail.appendChild(add);
		}
		if (mine.length > 0) {
			const badge = el("span", "bf-block__count");
			badge.textContent = String(mine.length);
			badge.title = mine.length === 1 ? "1 review comment" : mine.length + " review comments";
			badge.setAttribute("role", "img");
			// A fact beside the thread, not a status: aria-live would announce the count on every
			// frame and talk over the comment being written.
			badge.setAttribute("aria-label", badge.title);
			rail.appendChild(badge);
		}
		wrap.appendChild(rail);
		wrap.addEventListener("focusin", function () {
			const next = setActive(planEl, blockElements(planEl).indexOf(wrap));
			if (next !== null) deps.setActiveIndex(next);
		});
		planEl.appendChild(wrap);
		deps.renderComments(planEl, block.start, label);
	}
	const orphans = deps.annotations().filter((annotation) => !anchored[annotation.anchor]);
	if (orphans.length > 0) {
		const box = el("div", "bf-comments bf-comments--orphans");
		box.setAttribute("role", "list");
		box.setAttribute("aria-label", "Comments not attached to a current block");
		const note = el("p");
		note.textContent = "Comments not attached to a current block";
		box.appendChild(note);
		deps.renderCommentCards(box, orphans);
		planEl.appendChild(box);
	}
	planEl.scrollTop = scrollTop;
	// The DOM was rebuilt, so the active block's class is gone; restore it in place rather
	// than scrolling, so the keyboard resumes where the reviewer was.
	const activeIndex = deps.activeIndex();
	const active = activeIndex >= 0 ? blockElements(planEl)[activeIndex] : null;
	if (active) active.classList.add("bf-block--active");
	// A write asks for the card it changed; a stream frame asks for nothing, so the old tab
	// stop falls back to the block's control. An empty thread has no card to take it.
	const hint = deps.focusAfter ? deps.focusAfter() : null;
	let wanted: ClientNode | null = null;
	if (hint) {
		const thread = planEl.querySelector('.bf-comments[data-line="' + hint.line + '"]');
		const cards = thread ? thread.querySelectorAll(".bf-comment") : [];
		wanted = cards[Math.max(0, Math.min(hint.index, cards.length - 1))] ?? null;
		if (!wanted) {
			// The thread empties on the last delete: the block's control is the only place left
			// for the tab stop, even when no block was active before the click.
			const wrap = planEl.querySelector('.bf-block[data-line="' + hint.line + '"]');
			wanted = wrap ? wrap.querySelector(".bf-block__add") : null;
		}
		if (deps.clearFocusAfter) deps.clearFocusAfter();
	}
	if (wanted && wanted.focus) {
		wanted.focus();
	} else if (keepFocus && active) {
		const stop = active.querySelector(".bf-block__add");
		if (stop) stop.focus();
	}
	deps.facts();
	const installed = watch(planEl, deps.outlineList, previousWatch);
	deps.updateState();
	return installed;
}

/** The block renderer as source, for the client bundle. */
export const WEB_PLAN_JS = pageSource(renderPlanFrame);
