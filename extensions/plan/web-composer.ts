/**
 * The review page's composer lifecycle: closing it, reopening the one a reload interrupted,
 * and opening it on the block the keyboard is on.
 *
 * The sixth capability out of the review client's template literal, and the first that
 * needs a bundle rather than a list of arguments: closing touches the page, the status
 * line, the sentence that names a half-written comment, and the draft store — so those
 * arrive as one `ComposerDeps` the client builds where the state already exists. What
 * `openComposer` does with the block stays in `web-comments.ts`, which owns the form.
 */

import type { ClientNode } from "../../lib/web/client-runtime.ts";
import { blockAtLine, blockElements, type IslandBlock, setActive } from "./web-blocks.ts";

/** What opening a composer takes: the block, its island entry, a quote, and any draft. */
export type OpenComposer = (wrap: ClientNode, block: IslandBlock, quote: string, initial?: string) => void;

/** What the lifecycle reads of the page. Built where the state lives, once per call. */
export interface ComposerDeps {
	planEl: ClientNode | null;
	statusEl: ClientNode | null;
	/** The sentence that names a half-written comment, so a stale one can be cleared. */
	refusal: string;
	/** Whether the review has ended, so a key opens no composer for it. */
	settled?(): boolean;
	setStatus(text: string, kind?: string): void;
	saveDraft(): void;
	open: OpenComposer;
}

/**
 * Close the composer, and drop the text it was holding.
 *
 * A close is the reader's Cancel or Esc, or the commit that turned the text into a
 * comment: either way the composer is not somewhere to resume from, so the draft does not
 * keep it. What protects a half-written comment is the guards on the ways out — a repaint
 * that would close a composer asks first (`guardDraft`), the view control included — not
 * this function. A close with nothing open must not rewrite, and so drop, a draft a reload
 * restored.
 */
export function closeComposer(deps: ComposerDeps): void {
	const open = deps.planEl ? deps.planEl.querySelector(".bf-composer") : null;
	if (open) open.remove();
	const composing = deps.planEl ? deps.planEl.querySelectorAll(".bf-block--composing") : [];
	for (let i = 0; i < composing.length; i++) composing[i]?.classList.remove("bf-block--composing");
	// The only status a composer leaves behind is the refusal to leave it; once the draft is
	// gone that sentence is stale.
	if (deps.statusEl && deps.statusEl.textContent === deps.refusal) deps.setStatus("");
	// The composer is gone, so recomputing the draft now is what forgets the text it held —
	// a close is not a pause — while the comments this writer added stay in it.
	if (open) deps.saveDraft();
}

/**
 * Reopen the composer a reload interrupted, once its block has rendered.
 *
 * A review that has settled, been approved, or been closed has no draft to restore: the
 * text belonged to a page that is no longer asking.
 */
export function reopenComposer(
	deps: ComposerDeps,
	typing: { anchor: number; quote?: string; text?: string } | undefined,
	settled: { saved: boolean; approved: boolean; closed: boolean },
	blocks: readonly IslandBlock[],
): void {
	if (!typing || settled.saved || settled.approved || settled.closed) return;
	const target = blockAtLine(deps.planEl, blocks, typing.anchor);
	if (target) deps.open(target.wrap, target.block, typing.quote || "", typing.text);
}

/**
 * Open the composer on the block the keyboard is on, starting one if none is active.
 *
 * The index is returned so the client keeps its one `activeIndex`: opening a composer is a
 * navigation, and the block the reader lands on is the block they are commenting on.
 */
export function commentOnActive(deps: ComposerDeps, activeIndex: number, blocks: readonly IslandBlock[]): number {
	// A settled review takes no new comment, so the key opens nothing rather than a
	// composer whose note could never be saved.
	if (deps.settled?.() === true) return activeIndex;
	if (blockElements(deps.planEl).length === 0) return activeIndex;
	const index = activeIndex < 0 ? (setActive(deps.planEl, 0) ?? activeIndex) : activeIndex;
	const wrap = blockElements(deps.planEl)[Math.max(0, index)];
	if (!wrap) return index;
	const target = blockAtLine(deps.planEl, blocks, Number(wrap.getAttribute("data-line")));
	if (target) deps.open(target.wrap, target.block, "");
	return index;
}

/** The composer lifecycle as source, for the client bundle. */
export const WEB_COMPOSER_JS = [closeComposer, reopenComposer, commentOnActive].map(String).join("\n\n");
