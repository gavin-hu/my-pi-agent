/**
 * The arrival a section jump owes the reader: the section it scrolled to takes the keyboard.
 *
 * Written as ordinary TypeScript and exported as source — `WEB_JUMP_JS` — because the review
 * client is a template literal no compiler sees. The rule reads the document rather than the
 * outline's list: what a link names is a block id, and the block is what a screen reader needs to
 * land on.
 *
 * `tabindex="-1"` is the whole trick: a block is not focusable, and the attribute makes it a
 * focus target without making it a tab stop, so the sequential point the reader had on the link is
 * unchanged. `preventScroll` keeps the focus from moving the pane the link just scrolled — the
 * section observer is rooted in that pane, and a second scroll would hand it the wrong section.
 */

import { pageSource } from "../../lib/format.ts";
import type { ClientNode } from "../../lib/web/client-runtime.ts";

/** The block a jump names, focused without scrolling the pane it was scrolled into. */
export function focusSection(planEl: ClientNode | null, id: string): void {
	if (!planEl || !id) return;
	const block = planEl.querySelector("#" + id);
	if (!block) return;
	if (block.getAttribute("tabindex") === null) block.setAttribute("tabindex", "-1");
	block.focus({ preventScroll: true });
}

/** The rule and nothing else, for the client bundle. */
export const WEB_JUMP_JS = pageSource(focusSection);
