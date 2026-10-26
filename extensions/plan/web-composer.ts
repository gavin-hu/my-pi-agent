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
	setStatus(text: string, kind?: string): void;
	saveDraft(): void;
	open: OpenComposer;
}

/**
 * Close the composer, and let the stored draft follow it.
 *
 * A close with nothing open must not rewrite — and so drop — a draft a reload restored, so
 * the draft is saved only when a composer was actually there.
 */
export function closeComposer(deps: ComposerDeps): void {
	const open = deps.planEl ? deps.planEl.querySelector(".bf-composer") : null;
	if (open) open.remove();
	const composing = deps.planEl ? deps.planEl.querySelectorAll(".bf-block--composing") : [];
	for (let i = 0; i < composing.length; i++) composing[i]?.classList.remove("bf-block--composing");
	// The only status a composer leaves behind is the refusal to leave it; once the draft is
	// gone that sentence is stale.
	if (deps.statusEl && deps.statusEl.textContent === deps.refusal) deps.setStatus("");
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
