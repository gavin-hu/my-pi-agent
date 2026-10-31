/**
 * The board page's document, as a suite reads it.
 *
 * Two suites read the same rendered page — the page's own, and the card dialog's — and both
 * named the repository, the root, and the way the document is produced. One statement here
 * is what keeps the second copy from drifting: a suite that rendered the page some other way
 * would be testing a document nobody serves.
 *
 * `ownRules` is the page's own stylesheet, without the shared blocks that define the palette:
 * a colour literal is legal in the theme block and nowhere else, so the shared blocks are cut
 * from what a rule about the page's own rules reads.
 */

import { WEB_COMPONENTS_CSS } from "../../lib/web/index.ts";
import { type PageView, renderBoardPage } from "../../extensions/board/view/page.ts";
import { BOARD_CSS } from "../../extensions/board/view/styles.ts";

/** The repository the document's tests are a board of. */
export const REPO = "my-pi-agent";
/** The repository root the header carries as its hover title. */
export const ROOT = "/Users/someone/my-pi-agent";

/** The document as the server renders it, for the structure these tests read. */
export function boardDocument(view: PageView): string {
	return renderBoardPage({ view, base: "", repo: REPO, root: ROOT });
}

/** The page's own rules, without the shared blocks that define the palette. */
export function ownRules(): string {
	return BOARD_CSS.slice(BOARD_CSS.indexOf(WEB_COMPONENTS_CSS) + WEB_COMPONENTS_CSS.length);
}
