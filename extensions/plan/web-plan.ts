/**
 * The review page's plan renderer: the DOM a frame draws, thrown away and rebuilt.
 *
 * The seventh capability out of the review client's template literal, and the one with the
 * most to read: it builds every block, its comment rail, and the cards under it, then puts
 * the reader back where they were. Reads arrive through getters and mutations leave through
 * callbacks, so the client keeps every variable it owns — `activeIndex`, the quote a click
 * is waiting for, the observer — and this function holds only the shape of one frame.
 *
 * Two rules it owns, both about a repaint not stealing the reader's place:
 *
 * - focus is restored only when it was inside the plan to begin with, so a frame the stream
 *   caused cannot pull the keyboard out of the page the reviewer is working in;
 * - the active block's class is put back in place rather than by scrolling, so the arrow
 *   keys resume where they were instead of jumping to the top.
 */

import type { ClientNode } from "../../lib/web/client-runtime.ts";
import type { ComposerDeps } from "./web-composer.ts";
import { blockElements, type IslandBlock, setActive } from "./web-blocks.ts";
import type { SectionWatcher } from "./web-outline.ts";

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
	/** The composer lifecycle, for the close a repaint begins with. */
	composer(): ComposerDeps;
	/** The block's content, from the Markdown half. */
	renderBlock(wrap: ClientNode, block: IslandBlock): void;
	/** The cards under one block, and the loose ones that lost their anchor. */
	renderComments(scope: ClientNode, line: number): void;
	renderCommentCards(scope: ClientNode, list: readonly unknown[]): void;
	/** The text a reader selected inside a block, used as the next comment's quote. */
	selectionIn(wrap: ClientNode): string;
	open(wrap: ClientNode, block: IslandBlock, quote: string): void;
	/** The facts and the header chip, repainted after the blocks. */
	facts(): void;
	updateState(): void;
}

/**
 * Draw the plan, and put the reader back. Returns the section watcher it installed.
 *
 * The client's own zero-argument entry is `renderAll()`: it builds the frame's deps and
 * hands them here, which is how the fragments keep calling a name that takes nothing.
 */
export function renderPlanFrame(
	deps: PlanRenderDeps,
	closePlan: () => void,
	observe: (
		planEl: ClientNode | null,
		list: ClientNode | null,
		previous: SectionWatcher | null,
	) => SectionWatcher | null,
	previousObserver: SectionWatcher | null,
): SectionWatcher | null {
	const { planEl } = deps;
	if (!planEl) return previousObserver;
	// Focus is only put back when it was inside this document to begin with.
	const keepFocus = !!(deps.focused && deps.focused !== planEl && planEl.contains(deps.focused));
	closePlan();
	const scrollTop = planEl.scrollTop;
	planEl.replaceChildren();
	const anchored: Record<number, boolean> = {};
	for (const block of deps.blocks()) {
		if (block.kind === "blank") continue;
		anchored[block.start] = true;
		const wrap = el("div", "bf-block");
		wrap.setAttribute("data-line", String(block.start));
		wrap.setAttribute("data-kind", String(block.kind));
		// The one mark that says "read this line again": a block the last review did not have.
		if (deps.changed?.(block.start) === true) wrap.setAttribute("data-changed", "1");
		if (block.kind === "heading") wrap.id = "s-" + block.start;
		deps.renderBlock(wrap, block);
		const mine = deps.annotations().filter((annotation) => annotation.anchor === block.start);
		if (mine.length > 0) wrap.classList.add("bf-block--commented");
		const rail = el("div", "bf-block__rail");
		const add = el("button", "bf-block__add");
		add.type = "button";
		add.textContent = "+";
		add.setAttribute("aria-label", "Comment on this block");
		add.addEventListener("click", function () {
			// Read at click time, not at render time: a selection made after this frame is
			// the quote the reader means.
			const waiting = deps.pendingQuote();
			const quoted = waiting && waiting.wrap === wrap ? waiting.quote : deps.selectionIn(wrap);
			deps.clearPendingQuote();
			deps.open(wrap, block, quoted);
		});
		rail.appendChild(add);
		if (mine.length > 0) {
			const badge = el("span", "bf-block__count");
			badge.textContent = String(mine.length);
			badge.title = mine.length === 1 ? "1 review comment" : mine.length + " review comments";
			rail.appendChild(badge);
		}
		wrap.appendChild(rail);
		wrap.addEventListener("focusin", function () {
			const next = setActive(planEl, blockElements(planEl).indexOf(wrap));
			if (next !== null) deps.setActiveIndex(next);
		});
		planEl.appendChild(wrap);
		deps.renderComments(planEl, block.start);
	}
	const orphans = deps.annotations().filter((annotation) => !anchored[annotation.anchor]);
	if (orphans.length > 0) {
		const box = el("div", "bf-comments bf-comments--orphans");
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
	// The focused element went with the old DOM, so put the tab stop back on the block's
	// comment control: that is where adding, editing, or deleting left it.
	if (keepFocus && active) {
		const stop = active.querySelector(".bf-block__add");
		if (stop) stop.focus();
	}
	deps.facts();
	const observer = observe(planEl, deps.outlineList, previousObserver);
	deps.updateState();
	return observer;
}

/** The block renderer as source, for the client bundle. */
export const WEB_PLAN_JS = String(renderPlanFrame);
