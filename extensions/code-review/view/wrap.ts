/**
 * The wrap control both diff-reading pages carry.
 *
 * One body for the button, so the review page and the file view cannot disagree about its
 * label, its title, or the id the page's script binds. Only the markup is here: the script
 * that speaks for it is the review page's, and the file view's is the static variant,
 * because folding those two bodies together means rewriting the fold rule (#814) rather
 * than sharing a string.
 */

import { button } from "../../../lib/web/index.ts";

/** The wrap button, its pressed state saying whether the page's lines wrap. */
export function wrapButton(options: { pressed: boolean }): string {
	return button({ label: "wrap", id: "rv-wrap", pressed: options.pressed, title: "Toggle line wrapping" });
}
