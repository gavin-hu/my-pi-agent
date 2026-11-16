/**
 * Pure HTML atoms shared by the Bytefly browser pages.
 *
 * Each helper returns a string with every dynamic *value* escaped through
 * `lib/escape.ts`. Fields documented as trusted (`css`, an `icon` glyph, an
 * attribute key) are code-authored constants, never model or file text.
 */

import { escapeHtml } from "../escape.ts";
import { pageSource } from "../format.ts";
import { THEME_JS_PATH } from "./runtime.ts";
import { WEB_THEME_TOKENS } from "./tokens.ts";

/** Options for {@link docHead}. */
export interface DocHeadOptions {
	/** Page title, escaped. */
	title: string;
	/** Trusted CSS assembled by the page. */
	css: string;
	/**
	 * The mount prefix this page answers under, e.g. `/files`; `""` for the origin's
	 * root. A page's scripts and links are emitted under it, because a session serves
	 * several pages on one origin.
	 */
	base?: string;
}

/**
 * A page's browser-tab title: `<page> · <subject> · <count>`.
 *
 * One convention across the served pages, so a strip of tabs reads as one product. The
 * page's name comes first, lowercase and the same word `appHead`'s `product`
 * carries; then what the page is showing; then the count a reader opens the tab for. A
 * part the page does not have is left out rather than drawn empty, so a board with
 * nothing open reads `board · my-pi-agent` and a plan reads `plan review · <its title>`.
 */
export function tabTitle(product: string, subject?: string, count?: string): string {
	const kept = [product, subject, count];
	return kept.filter((part) => part !== undefined && part !== "").join(" · ");
}

/**
 * The same body, as the browser receives it.
 *
 * The board's count is live, so its tab is repainted on every frame and this rule has to
 * cross into the bundle. It is written as concatenation with no backtick and no
 * interpolation, because the bundle is a template the source is spliced into.
 */
export const TAB_TITLE_JS = pageSource(tabTitle);

/**
 * The `data-base` attribute a page's `<html>` carries, which its own bundle reads
 * (`base()` in `client-runtime.ts`) to build every URL it emits.
 *
 * `""` — the origin's root — writes nothing at all, so a page served alone is markup
 * without a mount to name.
 */
export function baseAttribute(base: string): string {
	return base === "" ? "" : ` data-base="${escapeHtml(base)}"`;
}

/**
 * The shared document head: charset, viewport, colour scheme, title, the page
 * CSS, and the pre-paint theme bootstrap. The body and its scripts stay with
 * each page.
 */
export function docHead(options: DocHeadOptions): string {
	return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(options.title)}</title>
${markIcon()}
<style>${options.css}</style>
<script src="${options.base ?? ""}${THEME_JS_PATH}"></script>`;
}

/**
 * The mark's blocks: `█▀█` over `█▀ █`, as `[x, height]` per row in a 4x2 grid.
 *
 * One shape, three places — the header lockup, the tab icon, and the TUI header's
 * half-blocks — so it is written once. The rows differ: the top fills x=2, the bottom
 * leaves it empty and fills x=3, which is what makes the mark read as two glyphs.
 */
const MARK_ROWS: ReadonlyArray<{ group: "top" | "bottom"; rects: ReadonlyArray<readonly [number, number]> }> = [
	{
		group: "top",
		rects: [
			[0, 1],
			[1, 0.5],
			[2, 1],
		],
	},
	{
		group: "bottom",
		rects: [
			[0, 1],
			[1, 0.5],
			[3, 1],
		],
	},
];

/** One row of the mark, as `<rect>`s starting at `y`. */
function markRowRects(row: (typeof MARK_ROWS)[number], y: number): string {
	return row.rects.map(([x, height]) => `<rect x="${x}" y="${y}" width="1" height="${height}"/>`).join("");
}

/**
 * The mark as a standalone SVG, in one appearance's colours.
 *
 * A favicon is its own document: it cannot read the page's tokens, so the fills are
 * resolved here from the same palette the page paints with, and each appearance gets
 * its own icon.
 */
function markSvg(fills: { top: string; bottom: string }): string {
	const rows = MARK_ROWS.map((row, index) => `<g fill="${fills[row.group]}">${markRowRects(row, index)}</g>`);
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 2">${rows.join("")}</svg>`;
}

/**
 * The tab icon: the mark, in the appearance the reader's system is in.
 *
 * The dark icon is the plain `rel="icon"` — the page paints dark at `:root`, and a
 * browser that reads no `media` query on an icon keeps it. The light one is the
 * override, so a light tab does not carry a mark tuned for a dark one.
 */
export function markIcon(): string {
	const dark = encodeURIComponent(
		markSvg({ top: WEB_THEME_TOKENS.dark["--accent"], bottom: WEB_THEME_TOKENS.dark["--warn"] }),
	);
	const light = encodeURIComponent(
		markSvg({ top: WEB_THEME_TOKENS.light["--accent"], bottom: WEB_THEME_TOKENS.light["--warn"] }),
	);
	return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${dark}">
<link rel="icon" type="image/svg+xml" media="(prefers-color-scheme: light)" href="data:image/svg+xml,${light}">`;
}

/**
 * The Bytefly nameplate: the two-tone half-block mark, the `bytefly` wordmark,
 * and the product name. The mark mirrors the TUI header (`█▀█` / `█▀ █`), drawn
 * as a 4x2 grid so the accent and warning rows stay crisp at any zoom.
 */
function brandLockup(product: string): string {
	const rows = MARK_ROWS.map((row, index) => `<g class="bf-mark__${row.group}">${markRowRects(row, index)}</g>`);
	return `<span class="bf-brand"><svg class="bf-mark" viewBox="0 0 4 2" aria-hidden="true">${rows.join("")}</svg><span class="bf-wordmark">bytefly</span><span class="bf-context">${escapeHtml(product)}</span><span class="bf-brand__rule" aria-hidden="true"></span></span>`;
}

/**
 * The theme toggle button. Keeps the `#theme-toggle` id and `.theme-glyph`
 * span the shared `THEME_TOGGLE_JS` scripts find.
 */
export function themeToggle(): string {
	return `<button type="button" class="bf-btn bf-btn--icon bf-theme-toggle" id="theme-toggle" aria-label="Toggle light and dark theme" title="Toggle light and dark theme"><span class="theme-glyph" aria-hidden="true">\u263E</span></button>`;
}

/**
 * The page's subject: what this page is of — a repository's name, a served root.
 *
 * It is the toolbar's splitter as well as its label, so the only thing after it is the page's
 * own facts and the app's chrome. The whole value is on the hover, because the line truncates
 * its head: two clones of one repository, or two served folders, are told apart by the path.
 */
/** What the identity row's subject says: the label, and the whole value it stands for. */
export interface PageSubjectOptions {
	/** Element id, for a client that repaints the label. */
	id?: string;
	/** Visible label, escaped. */
	label: string;
	/** The whole value, on the hover; the label may be a truncated head of it. */
	title: string;
}

function pageSubject(options: PageSubjectOptions): string {
	const id = options.id === undefined ? "" : ` id="${escapeHtml(options.id)}"`;
	return `<span class="bf-context bf-context--subject"${id} title="${escapeHtml(options.title)}">${escapeHtml(options.label)}</span>`;
}

/**
 * The live-state line: the state's colour, its glyph, and its word.
 *
 * The tone is a `bf-tone--*` modifier and the glyph is decoration, so a client repaints the
 * word and the class and never the shape ({@link paintLive} does exactly that). `attrs`
 * carries a page's own hooks — the browse pages put their polling interval and the revision
 * of what they drew there. The line is not a live region: the header is where a reader looks
 * for the state, and a page that announced every repaint would talk over its own content.
 */
export function liveChip(options: {
	id: string;
	label: string;
	title?: string;
	hidden?: boolean;
	attrs?: Record<string, string>;
}): string {
	const title = options.title === undefined ? "" : ` title="${escapeHtml(options.title)}"`;
	const attrs = Object.entries(options.attrs ?? {})
		.map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
		.join("");
	return `<span class="bf-live bf-tone--accent" id="${escapeHtml(options.id)}"${title}${attrs}${options.hidden ? " hidden" : ""}><span class="bf-live__glyph" aria-hidden="true">◉</span><span class="bf-live__text">${escapeHtml(options.label)}</span></span>`;
}

/**
 * The live line's one action: reload the page.
 *
 * It starts hidden and a client reveals it when the page stops being true — the folder it
 * drew changed on disk, or the stream it reads has gone. Reloading is not a write: a page
 * that cannot change a card can still ask the server for the page again.
 */
export function reloadChip(options: { title: string }): string {
	return `<button type="button" class="bf-reload bf-tone--warn" id="reload-hint" title="${escapeHtml(options.title)}" hidden><span aria-hidden="true">⟳</span>reload</button>`;
}

/** The `?` button that opens {@link keysSheet}, which is the one trigger both pages use. */
export function keysButton(): string {
	return button({
		label: "?",
		variant: "icon",
		id: "keys-open",
		title: "Keyboard shortcuts",
		attrs: { "aria-haspopup": "dialog" },
	});
}

/** The app's chrome, in the identity row's last zone: the key sheet, then the theme toggle. */
function toolbarChrome(): string {
	return `<div class="bf-app__chrome">${keysButton()}${themeToggle()}</div>`;
}

/** Options for {@link appHead}: the page's name, what it is of, and its own two rows. */
export interface AppHeadOptions {
	/** The product name the lockup carries, and the word `tabTitle` names the page by, e.g. `board`. */
	product: string;
	/** The page's subject, as the identity row's one truncating label reads it. */
	subject: PageSubjectOptions;
	/** Trusted markup for the facts zone: the live line, its reload, or the page's own sentence. */
	facts: string;
	/**
	 * Trusted markup for the page's own controls. Absent on a page with none, which has one row —
	 * and so no rule, because a line with nothing under it draws the head's border twice.
	 */
	controls?: string;
	/** A page's own class on the identity row, code-authored. */
	identityClass?: string;
	/** A page's own class on the control row, code-authored. */
	controlsClass?: string;
}

/**
 * The app head: the identity row, over the page's own control row when it has one.
 *
 * One atom writes the shell's whole header, so no page can put the row rule where no row follows
 * it: the mark, the subject, the facts and the app's chrome sit in the identity row, and the rule
 * and the control row are written only for a page that passes controls. A page's classes reach
 * its own row through `identityClass` and `controlsClass`; the zones themselves are the kit's.
 */
export function appHead(options: AppHeadOptions): string {
	const identity = options.identityClass === undefined ? "" : ` ${options.identityClass}`;
	const row = `<header class="bf-app__head"><div class="bf-app__id${identity}">${brandLockup(options.product)}${pageSubject(options.subject)}<div class="bf-app__facts">${options.facts}</div>${toolbarChrome()}</div>`;
	if (options.controls === undefined) return `${row}</header>`;
	const controls = options.controlsClass === undefined ? "" : ` ${options.controlsClass}`;
	return `${row}<div class="bf-app__rule"></div><div class="bf-app__ctl${controls}">${options.controls}</div></header>`;
}

/**
 * The footer: one line, and only where the page's content came from.
 *
 * The live state and the key-sheet affordance live in the header, which never scrolls away,
 * so a footer that repeated them would be a second place for a fact the reader already has.
 * The line wraps rather than cutting a fact off it, so the end that names the folder always
 * survives. `factsId` is for a page whose client keeps the line true after a frame; the
 * facts ride the document so a slow frame never leaves the footer blank.
 */
export function pageFooter(options: { facts: string; factsId?: string }): string {
	const id = options.factsId === undefined ? "" : ` id="${escapeHtml(options.factsId)}"`;
	return `<footer class="bf-app__foot"><span class="bf-footer__facts"${id}>${escapeHtml(options.facts)}</span></footer>`;
}

/** A state's tone, mapping to a `bf-tone--*` modifier. */
export type ChipTone = "accent" | "success" | "warn" | "danger" | "dim" | "muted";

/** Options for {@link chip}. */
export interface ChipOptions {
	/** Visible text, escaped. */
	label: string;
	/** Optional tone modifier. */
	tone?: ChipTone;
	/** Trusted leading glyph or SVG. */
	icon?: string;
	/** A page's own class, code-authored, appended after the kit's own. */
	className?: string;
	/** Extra code-authored attributes — a tooltip, an accessible name; keys and values escaped. */
	attrs?: Record<string, string>;
}

/** A status tag: a glyph and a word on a 2px rail, with no box around them. */
export function chip(options: ChipOptions): string {
	const tone = options.tone ? ` bf-tone--${options.tone}` : "";
	const page = options.className ? ` ${options.className}` : "";
	const icon = options.icon ? `<span class="bf-tag__glyph" aria-hidden="true">${options.icon}</span>` : "";
	const attrs = Object.entries(options.attrs ?? {})
		.map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
		.join("");
	return `<span class="bf-tag${tone}${page}"${attrs}>${icon}${escapeHtml(options.label)}</span>`;
}

/** A button variant, mapping to a `bf-btn--*` modifier. */
export type ButtonVariant = "primary" | "ghost" | "icon";

/** Options for {@link button}. */
export interface ButtonOptions {
	/** Visible text, escaped. */
	label: string;
	/** Optional variant modifier. */
	variant?: ButtonVariant;
	/** Element id. */
	id?: string;
	/** Tooltip and accessible name. */
	title?: string;
	/** Sets `aria-pressed` when defined. */
	pressed?: boolean;
	/** Extra code-authored attributes; keys and values are escaped. */
	attrs?: Record<string, string>;
}

/** A `type="button"` control wired to the kit classes. */
export function button(options: ButtonOptions): string {
	const classes = options.variant ? `bf-btn bf-btn--${options.variant}` : "bf-btn";
	const attrs: Array<[string, string]> = [];
	if (options.id) attrs.push(["id", options.id]);
	if (options.title) attrs.push(["title", options.title]);
	if (options.pressed !== undefined) attrs.push(["aria-pressed", String(options.pressed)]);
	for (const [key, value] of Object.entries(options.attrs ?? {})) attrs.push([key, value]);
	const rendered = attrs.map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join("");
	return `<button type="button" class="${classes}"${rendered}>${escapeHtml(options.label)}</button>`;
}

/** One row of the keyboard sheet: the key or chord, and what it does. */
export interface KeyHint {
	/** The key or chord, one `<kbd>` per entry; a single string is one key, chord, or alias run. */
	keys: string | readonly string[];
	/** What the key does. */
	label: string;
}

/**
 * The `?` keyboard sheet: the dialog of key/label rows both pages share, hidden
 * until the client opens it.
 *
 * The ids are the contract with `keysDialogScript` in `runtime.ts` — `#keys-dialog`
 * for the sheet, `#keys-close` for its own close button — and its trigger is
 * {@link keysButton}.
 */
export function keysSheet(rows: readonly KeyHint[], note?: string): string {
	const kbd = (key: string): string => `<kbd class="bf-kbd">${escapeHtml(key)}</kbd>`;
	const body = rows
		.map((row) => {
			const keys = typeof row.keys === "string" ? kbd(row.keys) : row.keys.map(kbd).join(" ");
			return `<div><dt>${keys}</dt><dd>${escapeHtml(row.label)}</dd></div>`;
		})
		.join("\n");
	return `<div class="bf-dialog" id="keys-dialog" hidden>
<div class="bf-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="keys-title">
<div class="bf-dialog__head"><h2 id="keys-title">Keyboard shortcuts</h2><span class="bf-spacer"></span><button type="button" class="bf-btn" id="keys-close">Close</button></div>
<dl class="bf-keys">${body}</dl>
${note === undefined ? "" : `<p class="bf-keys__note">${escapeHtml(note)}</p>`}
</div>
</div>`;
}
