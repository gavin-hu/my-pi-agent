/**
 * A page's stylesheet: the kit's four layers, then the page's own rules.
 *
 * Every served document ships one sheet, and the sheet is the same four blocks in the same
 * order before the page adds anything. That order is a contract rather than a preference: a
 * page overrides a kit class at equal specificity, which only a rule that comes later can do.
 * Written here once, a fifth layer is one edit; written in each page, it was three, and the
 * join was three copies of a newline that decides where a page's own sheet begins.
 */

import { WEB_BASE_CSS } from "./base.ts";
import { WEB_COMPONENTS_CSS } from "./components.ts";
import { WEB_LAYOUT_CSS } from "./layout.ts";
import { WEB_THEME_CSS } from "./tokens.ts";

/**
 * One page's whole stylesheet.
 *
 * The layers go down in the order a page needs them — the reset, the palette it paints with,
 * the app shell, then the components — and `own` follows, so a page's rule can override any of
 * them. `own` is trusted CSS the page assembles, the same way `docHead` trusts its `css`; a page
 * that needs a blank line between the kit and its first rule starts its own sheet with one.
 */
export function pageSheet(own: string): string {
	return `${WEB_BASE_CSS}\n${WEB_THEME_CSS}\n${WEB_LAYOUT_CSS}\n${WEB_COMPONENTS_CSS}\n${own}`;
}
