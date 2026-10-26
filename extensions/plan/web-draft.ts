/**
 * The review page's draft guard: a composer holding text the page has not committed.
 *
 * The fifth capability out of the review client's template literal. `draftTextarea` is
 * pure — hand it the plan element and it answers the open composer's textarea, or nothing.
 * `guardDraft` is the rule built on it: the ways off the page refuse while a draft exists,
 * say why in the status line, and leave the cursor where the text is, so the reader is not
 * told about a draft they then have to hunt for.
 */

import type { ClientNode } from "../../lib/web/client-runtime.ts";

/** The open composer's textarea, when it holds anything a reader would lose. */
export function draftTextarea(planEl: ClientNode | null): { value: string; focus(): void } | null {
	const open = planEl ? planEl.querySelector(".bf-composer") : null;
	const area = open ? (open.querySelector("textarea") as { value: string; focus(): void } | null) : null;
	return area && area.value.trim() ? area : null;
}

/**
 * Whether an action must stop because a comment is half-written, and say so if it must.
 *
 * The refusal is the status line's own sentence rather than an alert: every way off the
 * page runs this, and a modal on each of them would be four dialogs for one fact.
 */
export function guardDraft(
	planEl: ClientNode | null,
	statusEl: ClientNode | null,
	refusal: string,
	paint: (node: ClientNode, text: string, kind?: string) => void,
): boolean {
	const area = draftTextarea(planEl);
	if (!area) return false;
	if (statusEl) paint(statusEl, refusal, "error");
	area.focus();
	return true;
}

/** The draft rules as source, for the client bundle. */
export const WEB_DRAFT_JS = [draftTextarea, guardDraft].map(String).join("\n\n");
