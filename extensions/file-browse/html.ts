/**
 * HTML rendering for the browse pages.
 *
 * Pure string building: the router reads the filesystem and hands these
 * renderers plain view models. Everything user-controlled is escaped, links are
 * percent-encoded per segment, and the only script is the same-origin
 * `/app.js`. The shared Bytefly shell and components come from `lib/web`; the
 * `browse-*` rules below are the page-only layer.
 */

import { GLYPHS } from "../../lib/tui/glyphs.ts";
import {
	brandLockup,
	docHead,
	SIDEBAR_COLLAPSE_MAX,
	WEB_BASE_CSS,
	WEB_COMPONENTS_CSS,
	WEB_LAYOUT_CSS,
	WEB_THEME_CSS,
} from "../../lib/web/index.ts";
import { escapeHtml } from "../../lib/escape.ts";
import { formatSize, type DirEntry, type FileView, type Listing, type TreeNode } from "./files.ts";
import { DIFF_MODES, statusLetter, type ChangedFile, type DiffLine, type DiffMode } from "./diff.ts";
import type { DiffFileView, GitStatus } from "./git.ts";
import { detectLanguage, highlightLines, type HighlightLanguage } from "../../lib/highlight.ts";
import { FOLDER_ICON, iconHref, languageOf, SPRITE, type IconSpec } from "./icons.ts";
import { renderMarkdown } from "./markdown.ts";
import { encodePath } from "./paths.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A short local date like `Oct 8 20:31`. */
export function formatDate(ms: number): string {
	const date = new Date(ms);
	if (Number.isNaN(date.getTime())) return "—";
	const hh = String(date.getHours()).padStart(2, "0");
	const mm = String(date.getMinutes()).padStart(2, "0");
	return `${MONTHS[date.getMonth()]} ${date.getDate()} ${hh}:${mm}`;
}

function iconMarkup(spec: IconSpec, hidden = false): string {
	return `<svg class="browse-cat ${spec.colorClass}"${hidden ? " hidden" : ""} aria-hidden="true" title="${escapeHtml(spec.label)}"><use href="${iconHref(spec.icon)}"/></svg>`;
}

/** The header's git chip: the branch, or the detached head; changes are the changes chip's job. */
function renderGit(git: GitStatus | undefined): string {
	if (!git) return "";
	const name = git.branch ?? git.head;
	if (!name) return "";
	const glyph = git.branch ? GLYPHS.branch : GLYPHS.detached;
	const aria = git.branch ? `git branch ${git.branch}` : `git detached at ${git.head ?? ""}`;
	return `<span class="bf-chip browse-git" title="${escapeHtml(aria)}" aria-label="${escapeHtml(aria)}"><span class="browse-git__glyph" aria-hidden="true">${escapeHtml(glyph)}</span>${escapeHtml(name)}</span>`;
}

/** The changed-path index for markers, plus the totals shown in the chip. */
export interface ChangeSummary {
	count: number;
	insertions: number;
	deletions: number;
	files: ReadonlySet<string>;
	dirs: ReadonlySet<string>;
}

/** Whether a path carries a change marker: a changed file, or a directory above one. */
function isChanged(summary: ChangeSummary | undefined, rel: string, isDir: boolean): boolean {
	if (!summary || !rel) return false;
	return isDir ? summary.dirs.has(rel) : summary.files.has(rel);
}

/** A small dot marking a changed file or a directory that contains one. */
function changeMark(summary: ChangeSummary | undefined, rel: string, isDir: boolean): string {
	return isChanged(summary, rel, isDir)
		? `<span class="browse-change" title="uncommitted changes" aria-label="uncommitted changes">●</span>`
		: "";
}

/** The header's changes chip, linking to the diff overview when there are changes. */
function renderChanges(summary: ChangeSummary | undefined): string {
	if (!summary || summary.count <= 0) return "";
	const label = `${summary.count} change${summary.count === 1 ? "" : "s"}`;
	const totals =
		summary.insertions + summary.deletions > 0
			? ` <span class="browse-diff-totals"><span class="browse-diff-add">+${summary.insertions}</span> <span class="browse-diff-del">−${summary.deletions}</span></span>`
			: "";
	const aria = `${label} against HEAD${summary.insertions + summary.deletions > 0 ? `, ${summary.insertions} insertions and ${summary.deletions} deletions` : ""}`;
	return `<a class="bf-chip browse-diff" href="/diff" title="View uncommitted changes" aria-label="${escapeHtml(aria)}"><span class="browse-diff__dot" aria-hidden="true">●</span>${escapeHtml(label)}${totals}</a>`;
}

function hrefFor(entry: { rel: string; isDir: boolean }): string {
	return entry.isDir ? `/browse/${encodePath(entry.rel)}` : `/view/${encodePath(entry.rel)}`;
}

/** The shared shell, components, and the page-only `browse-*` rules. */
const STYLES = `${WEB_BASE_CSS}
${WEB_THEME_CSS}
${WEB_LAYOUT_CSS}
${WEB_COMPONENTS_CSS}
.browse-side{padding:var(--space-3)}
.browse-root{flex:1 1 auto;direction:rtl;text-align:left}
.browse-git{font-family:var(--font-mono)}
.browse-quick-open{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);width:100%;margin-bottom:var(--space-2);padding:6px var(--space-2);border:1px solid var(--border);border-radius:var(--radius-md);background:var(--canvas);color:var(--muted);font:var(--fs-sm) var(--font-ui);cursor:pointer}
.browse-quick-open:hover{border-color:var(--accent);color:var(--accent)}
.browse-quick-open kbd{font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--dim)}
.browse-side__filters{display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2)}
.browse-side__filters .bf-field{flex:1 1 auto;min-width:0}
.browse-side__filters .bf-btn{flex:0 0 auto;white-space:nowrap}
.browse-cat{width:16px;height:16px;flex:0 0 16px;color:var(--accent)}
.browse-cat.doc{color:var(--muted)}.browse-cat.img{color:var(--success)}.browse-cat.cfg{color:var(--warn)}.browse-cat.arc{color:var(--warn)}
.browse-heading{margin:0 0 var(--space-3);font-size:var(--fs-lg)}
.browse-listing th.bf-table__size,.browse-listing th.bf-table__when{text-align:right}
.browse-listing th.bf-table__size{width:96px}
.browse-listing th.bf-table__when{width:140px}
.browse-dotfile .bf-table__name a{opacity:.72}
.browse-broken{color:var(--muted);text-decoration:line-through}
.browse-link-mark{color:var(--muted);font-size:var(--fs-xs)}
.browse-when{display:none}
body.palette-open{overflow:hidden}
.browse-diff{font-family:var(--font-mono);gap:5px}
.browse-diff:hover{color:var(--accent);text-decoration:none}
.browse-diff__dot{color:var(--warn);font-size:9px;line-height:1}
.browse-change{color:var(--warn);font-size:9px;line-height:1;flex:0 0 auto}
.browse-diff-totals{font-family:var(--font-mono)}
.browse-diff-add{color:var(--success)}
.browse-diff-del{color:var(--danger)}
.browse-diff-scope{color:var(--muted);font-size:var(--fs-sm);font-weight:var(--fw-medium)}
.browse-diff-toolbar{display:flex;align-items:center;gap:var(--space-3);margin:0 0 var(--space-3);flex-wrap:wrap}
.browse-diff-stat{margin:0 0 var(--space-3);font:var(--fs-xs)/1.5 var(--font-mono);color:var(--muted);white-space:pre-wrap;overflow-x:auto}
.browse-diff th.browse-diff-status{width:72px}
.browse-diff th.browse-diff-word{width:130px}
.browse-diff-badge{display:inline-block;min-width:16px;text-align:center;font:var(--fw-semibold) var(--fs-xs) var(--font-mono);border-radius:var(--radius-sm);padding:1px 5px;border:1px solid var(--border)}
.browse-diff-badge--M{color:var(--warn);border-color:currentColor}
.browse-diff-badge--A,.browse-diff-badge--Q{color:var(--success);border-color:currentColor}
.browse-diff-badge--D{color:var(--danger);border-color:currentColor}
.browse-diff-badge--R,.browse-diff-badge--C{color:var(--accent);border-color:currentColor}
.browse-diff-orig{color:var(--muted);font-size:var(--fs-xs)}
.browse-diff-word{color:var(--muted);font-size:var(--fs-sm)}
.browse-diff-no{display:inline-block;width:46px;padding-right:var(--space-2);text-align:right;color:var(--dim);user-select:none}
.browse-diff-sign{display:inline-block;width:16px;text-align:center;color:var(--muted);user-select:none}
.bf-diff-line--add{background:var(--success-soft)}
.bf-diff-line--add .browse-diff-sign{color:var(--success)}
.bf-diff-line--del{background:var(--danger-soft)}
.bf-diff-line--del .browse-diff-sign{color:var(--danger)}
.bf-diff-line--hunk{color:var(--accent);background:var(--canvas)}
.bf-diff-line--meta{color:var(--muted)}
.bf-diff-line--note{color:var(--muted);font-style:italic}
/* A hunk header pins to the top of the diff viewport while its body scrolls.
   Each hunk is a section so the pinned header is bounded by its own body and
   cannot stack on the next one. */
.bf-diff-hunk{display:block}
.bf-diff .bf-diff-line--hunk{position:sticky;top:0;z-index:1}
/* Reading progress, pinned to the sticky header's bottom edge. */
.browse-progress{position:absolute;left:0;right:0;bottom:-1px;height:2px;overflow:hidden}
.browse-progress__fill{display:block;height:100%;width:0;background:var(--accent);transition:width var(--motion-fast) linear}
/* File and diff pages: a measured reading column inside the card. */
/* The Markdown body fills the card, so the scroll box is the card's width: its
   scrollbar sits at the card edge. The measure lives on the blocks themselves:
   on .bf-md it would be a flex item with auto inline margins, which is
   shrink-to-fit, so a short document collapsed to its widest line. It is a rem
   length so every block resolves the same measure whatever its font. */
.browse-measure{--browse-measure:min(1012px,46rem)}
.browse-measure .bf-md{--browse-gutter:max(0px,calc((100% - var(--browse-measure)) / 2));max-width:none;margin-inline:0;padding-inline:var(--space-5);padding-block:var(--space-4) var(--space-6)}
.browse-measure .bf-md>*{max-width:var(--browse-measure);margin-inline:auto}
/* Tables start at the prose column and take only the gutter to its right, so a
   wide window widens them without a dead band on their left. Code stays inside
   the measure with the rest of the prose. */
.browse-measure .bf-md>.md-table-frame{max-width:none;padding-left:var(--browse-gutter)}
/* A table wider than the pane scrolls, but an overlay scrollbar is invisible
   until it moves; a gradient on the frame marks the columns still out of view.
   It has to be the frame: the scroller clips its own content, so a pseudo-element
   inside it would scroll away with the table. */
.browse-measure .bf-md>.md-table-frame.browse-table-more::after{content:"";position:absolute;top:0;right:0;bottom:0;width:40px;pointer-events:none;background:linear-gradient(to left,var(--surface) 12%,transparent)}
.bf-card__meta{font-variant-numeric:tabular-nums}
.browse-diff-summary{font-family:var(--font-mono);white-space:nowrap}
.browse-diff-summary .browse-diff-add{color:var(--success)}
.browse-diff-summary .browse-diff-del{color:var(--danger)}
.browse-hunks{color:var(--muted)}
.browse-keys{display:grid;grid-template-columns:auto 1fr;gap:8px var(--space-4);margin:0;padding:var(--space-4)}
.browse-keys dt{white-space:nowrap}
.browse-keys dd{margin:0;color:var(--muted);font-size:var(--fs-sm)}
.browse-kbd{display:inline-block;min-width:20px;padding:1px 6px;border:1px solid var(--border);border-bottom-width:2px;border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font:var(--fs-xs) var(--font-mono);text-align:center}
/* Wide screens: pin quick open and the filter, and scroll the tree on its own
   box. The sidebar is a details element, whose content sits in an anonymous
   wrapper with no definite height, so the panel fills the sidebar by absolute
   positioning; below the sidebar breakpoint the disclosure keeps normal page
   scroll. */
@media not (max-width:${SIDEBAR_COLLAPSE_MAX}px){
.browse-sidebar{position:relative;overflow:hidden}
.browse-side{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden}
.browse-side .bf-tree{flex:1 1 auto;min-height:0;overflow:auto}
}
@media (max-width:820px){
.browse-root{order:9;flex:1 1 100%;direction:ltr;text-align:left}
}
@media (max-width:520px){
.bf-toolbar .bf-theme-toggle{margin-left:auto}
}`;

/** One row of the keyboard sheet: the key or chord, and what it does. */
export interface KeyHint {
	keys: string;
	label: string;
}

interface Layout {
	title: string;
	rootLabel: string;
	tree: TreeNode;
	currentRel: string;
	breadcrumbs: string;
	main: string;
	footerNote: string;
	/** Extra classes on `main`, for page-scoped rules. */
	mainClass?: string;
	/** Rows for the `?` keyboard sheet; omitted when the page has no shortcuts. */
	keys?: KeyHint[];
	git?: GitStatus;
	/** Changed-path index for the header chip and the tree markers; omitted when clean. */
	summary?: ChangeSummary;
}

/** The `?` keyboard sheet, hidden until the client opens it. */
function renderKeysSheet(keys: KeyHint[]): string {
	const rows = keys
		.map(
			(key) =>
				`<div><dt><kbd class="browse-kbd">${escapeHtml(key.keys)}</kbd></dt><dd>${escapeHtml(key.label)}</dd></div>`,
		)
		.join("");
	return `<div class="bf-dialog" id="keys-dialog" hidden>
<div class="bf-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="keys-title">
<div class="bf-dialog__head"><h2 id="keys-title">Keyboard shortcuts</h2><span class="bf-spacer"></span><button type="button" class="bf-btn" id="keys-close">Close</button></div>
<dl class="browse-keys">${rows}</dl>
</div>
</div>`;
}

/** A full two-pane page. */
function renderLayout(layout: Layout): string {
	return `<!doctype html>
<html lang="en">
<head>
${docHead({ title: layout.title, css: STYLES })}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='6' fill='%2358a6ff'/%3E%3C/svg%3E">
</head>
<body class="bf-app">
<a class="skip" href="#main">Skip to content</a>
<p class="sr-only" id="copy-status" role="status" aria-live="polite"></p>
<noscript><style>.bf-field{display:none}.browse-side__filters{display:none}.bf-tree__tw--toggle{visibility:hidden}.bf-btn{display:none}.browse-quick-open{display:none}th .bf-sort{pointer-events:none;cursor:default}</style></noscript>
${SPRITE}
<header class="bf-app__header"><div class="bf-toolbar">
  ${brandLockup("browse")}
  <span class="bf-context browse-root">${escapeHtml(layout.rootLabel)}</span>
  ${renderGit(layout.git)}
  ${renderChanges(layout.summary)}
  <span class="bf-chip bf-chip--accent">read-only</span>
  <button type="button" class="bf-btn bf-btn--icon browse-keys-btn" id="keys-open" aria-label="Keyboard shortcuts" title="Keyboard shortcuts">?</button>
  <button type="button" class="bf-btn bf-btn--icon bf-theme-toggle" id="theme-toggle" aria-label="Toggle light and dark theme" title="Toggle light and dark theme"><span class="theme-glyph" aria-hidden="true">☾</span></button>
</div><div class="browse-progress" aria-hidden="true"><span class="browse-progress__fill" id="progress-fill"></span></div></header>
<div class="bf-app__body">
  <details class="bf-app__sidebar browse-sidebar" open>
    <summary class="bf-panel__summary">Files</summary>
    <aside class="bf-panel browse-side">
      <button type="button" class="browse-quick-open" id="quick-open" aria-haspopup="dialog"><span>quick open</span><kbd>/</kbd></button>
      <div class="browse-side__filters">
        <label class="bf-field">⌕ <input class="bf-input" id="filter" type="search" placeholder="filter paths…" aria-label="Filter paths"></label>
        <button type="button" class="bf-btn" id="fold-all" title="Fold or expand every folder">fold all</button>
      </div>
      <nav class="bf-tree" aria-label="File tree">${renderTree(layout.tree, layout.currentRel, layout.summary)}</nav>
      <p class="bf-note" id="tree-empty" hidden>No matches.</p>
    </aside>
  </details>
  <main class="bf-app__main${layout.mainClass ? ` ${layout.mainClass}` : ""}" id="main" tabindex="-1">
    <nav class="bf-crumbs" aria-label="Breadcrumb">${layout.breadcrumbs}</nav>
${layout.main}
  </main>
</div>
<footer class="bf-app__footer">served from ${escapeHtml(layout.rootLabel)} · read-only · ${escapeHtml(layout.footerNote)}</footer>
${layout.keys && layout.keys.length > 0 ? renderKeysSheet(layout.keys) : ""}
<script src="/app.js" defer></script>
</body>
</html>
`;
}

/** The breadcrumb trail for a root-relative path, up to (not including) the current page. */
export function renderBreadcrumbs(rel: string): string {
	const segments = rel.split("/").filter(Boolean);
	if (segments.length === 0) return `<span aria-current="page">home</span>`;
	// The last segment is the current page, which the heading or card title names;
	// the trail stops at its parent so the name is not shown twice.
	const parts = [`<a href="/browse/">home</a>`];
	let accumulated = "";
	for (const segment of segments.slice(0, -1)) {
		accumulated = accumulated ? `${accumulated}/${segment}` : segment;
		parts.push(`<a href="/browse/${encodePath(accumulated)}">${escapeHtml(segment)}</a>`);
	}
	return parts.join(`<span class="bf-crumbs__sep">/</span>`);
}

function renderTree(node: TreeNode, currentRel: string, summary?: ChangeSummary): string {
	return `<ul>${renderTreeNode(node, currentRel, summary)}</ul>`;
}

function renderTreeNode(node: TreeNode, currentRel: string, summary?: ChangeSummary): string {
	const expanded = node.children.length > 0;
	const isDir = node.isDir;
	const spec = isDir ? FOLDER_ICON : languageOf(node.name);
	const href = hrefFor(node);
	const current = node.rel === currentRel ? ` aria-current="page"` : "";
	const twisty = isDir
		? `<button type="button" class="bf-tree__tw bf-tree__tw--toggle" aria-expanded="${expanded}" aria-label="${escapeHtml(node.name)}">${expanded ? "▾" : "▸"}</button>`
		: `<span class="bf-tree__tw bf-tree__tw--spacer" aria-hidden="true"></span>`;
	const dataPath = ` data-path="${escapeHtml(node.rel)}"`;
	const name = isDir ? `${escapeHtml(node.name)}/` : escapeHtml(node.name);
	const children = expanded
		? `<ul>${node.children.map((child) => renderTreeNode(child, currentRel, summary)).join("")}</ul>`
		: "";
	const label = node.broken
		? `<span class="browse-broken" title="broken symbolic link">${name}</span><span class="browse-link-mark">↩</span>`
		: `<a href="${href}">${name}</a>`;
	return `<li data-open="${expanded}"><div class="bf-tree__row"${current}${dataPath}>${twisty}${iconMarkup(spec)}${label}${changeMark(summary, node.rel, isDir)}</div>${children}</li>`;
}

function renderRow(entry: DirEntry, maxThumbBytes: number, thumbnails: boolean, summary?: ChangeSummary): string {
	const spec = entry.isDir ? FOLDER_ICON : languageOf(entry.name);
	const showThumb = thumbnails && entry.isImage && !entry.broken && entry.size <= maxThumbBytes;
	const visual = showThumb
		? `<img class="bf-table__thumb" alt="" loading="lazy" decoding="async" src="/raw/${encodePath(entry.rel)}">${iconMarkup(spec, true)}`
		: iconMarkup(spec);
	const name = entry.isDir ? `${escapeHtml(entry.name)}/` : escapeHtml(entry.name);
	const classes = [entry.name.startsWith(".") ? "browse-dotfile" : "", entry.isSymlink ? "browse-symlink" : ""]
		.filter(Boolean)
		.join(" ");
	const link = entry.broken
		? `<span class="browse-broken" title="broken symbolic link">${name}</span>`
		: `<a href="${hrefFor(entry)}">${name}</a>`;
	const mark = entry.isSymlink
		? `<span class="browse-link-mark" title="${entry.broken ? "broken symbolic link" : "symbolic link"}">↩</span>`
		: "";
	const attrs = `data-name="${escapeHtml(entry.name)}" data-path="${escapeHtml(entry.rel)}" data-dir="${entry.isDir ? "1" : "0"}" data-size="${entry.size}" data-mtime="${Math.round(entry.mtimeMs)}"`;
	return `<tr${classes ? ` class="${classes}"` : ""} ${attrs}><td><span class="bf-table__name">${visual}${link}${changeMark(summary, entry.rel, entry.isDir)}${mark}</span></td><td class="bf-table__size">${entry.isDir ? "—" : escapeHtml(formatSize(entry.size))}</td><td class="bf-table__when">${entry.isDir ? "—" : escapeHtml(formatDate(entry.mtimeMs))}</td></tr>`;
}

export interface DirectoryPage {
	rootLabel: string;
	rel: string;
	listing: Listing;
	tree: TreeNode;
	thumbnails: boolean;
	maxThumbBytes: number;
	git?: GitStatus;
	/** Changed-path index for the header chip and markers. */
	summary?: ChangeSummary;
}

/** Render a directory listing page. */
export function renderDirectoryPage(page: DirectoryPage): string {
	// At the root there is no folder name to show, so the served folder names it.
	const folderName = page.rel ? lastSegment(page.rel) : lastSegment(page.rootLabel) || "/";
	const heading = `<h1 class="bf-title browse-heading" id="page-title">${escapeHtml(folderName)}</h1>`;
	let body = `<table class="bf-table browse-listing" aria-labelledby="page-title">
<thead><tr><th scope="col" aria-sort="ascending"><button type="button" class="bf-sort" data-sort="name" title="Sort by name">Name</button></th><th scope="col" class="bf-table__size"><button type="button" class="bf-sort" data-sort="size" title="Sort by size">Size</button></th><th scope="col" class="bf-table__when"><button type="button" class="bf-sort" data-sort="mtime" title="Sort by modified time">Modified</button></th></tr></thead>
<tbody>
${page.listing.entries.map((entry) => renderRow(entry, page.maxThumbBytes, page.thumbnails, page.summary)).join("\n")}
</tbody>
</table>`;
	if (page.listing.entries.length === 0) body = `<div class="bf-empty">This folder is empty.</div>`;
	else if (page.listing.truncated)
		body += `<p class="bf-note">Showing the first ${page.listing.entries.length} of ${page.listing.total} entries.</p>`;

	return renderLayout({
		title: `browse · ${page.rel || folderName}`,
		rootLabel: page.rootLabel,
		tree: page.tree,
		currentRel: page.rel,
		breadcrumbs: renderBreadcrumbs(page.rel),
		keys: pageKeys(),
		main: `    ${heading}\n    ${body}`,
		footerNote: `${page.listing.total} entr${page.listing.total === 1 ? "y" : "ies"}`,
		git: page.git,
		summary: page.summary,
	});
}

export interface FilePage {
	rootLabel: string;
	rel: string;
	file: FileView;
	tree: TreeNode;
	maxFileBytes: number;
	git?: GitStatus;
	/** Show the Markdown source instead of the rendered HTML. */
	markdownRaw?: boolean;
	/** Re-emit sanitized raw HTML in rendered Markdown; `false` escapes it as text. */
	markdownHtml?: boolean;
	/** True when this file has uncommitted changes, for the changes action. */
	changed?: boolean;
	/** Changed-path index for the header chip and the tree markers. */
	summary?: ChangeSummary;
}

/** The root-relative directory of a file, for resolving its Markdown links. */
function markdownBaseDir(rel: string): string {
	const slash = rel.lastIndexOf("/");
	return slash === -1 ? "" : rel.slice(0, slash);
}

function renderCodeLines(lines: string[], language?: HighlightLanguage): string {
	const rendered = language ? highlightLines(lines, language) : lines.map((line) => escapeHtml(line));
	return rendered.map((html) => `<span class="bf-code__line">${html.length > 0 ? html : " "}</span>`).join("");
}

/** The last segment of a root-relative path, or the path itself when it has none. */
function lastSegment(path: string): string {
	const trimmed = path.replace(/[/\\]+$/, "");
	const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/** The shortcuts every page shares, plus whatever the page adds. */
function pageKeys(...extra: KeyHint[]): KeyHint[] {
	return [
		{ keys: "/ ⌘K", label: "Quick open a file" },
		{ keys: "-", label: "Fold or expand every folder" },
		...extra,
		{ keys: "?", label: "This sheet" },
	];
}

/** The card-head controls: Markdown mode, line wrapping, and copy actions. */
function renderFileActions(page: FilePage): string {
	const isMarkdown = page.file.kind === "markdown";
	const rawHref = `/raw/${encodePath(page.rel)}`;
	const viewHref = `/view/${encodePath(page.rel)}`;
	const groups: string[] = [];
	if (page.changed) {
		groups.push(
			`<a class="bf-btn" href="/diff/${encodePath(page.rel)}" title="View this file's uncommitted changes">changes</a>`,
		);
	}
	if (isMarkdown) {
		const rendered = page.markdownRaw
			? `<a class="bf-segmented__item" href="${viewHref}">rendered</a>`
			: `<a class="bf-segmented__item" href="${viewHref}" aria-current="page">rendered</a>`;
		const raw = page.markdownRaw
			? `<a class="bf-segmented__item" href="${viewHref}?raw=1" aria-current="page">raw</a>`
			: `<a class="bf-segmented__item" href="${viewHref}?raw=1">raw</a>`;
		groups.push(`<span class="bf-segmented" role="group" aria-label="Markdown view">${rendered}${raw}</span>`);
	}
	if (page.file.kind === "text" || (isMarkdown && page.markdownRaw)) {
		groups.push(
			`<button type="button" class="bf-btn" id="wrap-toggle" aria-pressed="false" title="Toggle line wrapping">wrap</button>`,
		);
	}
	if (page.file.kind === "text" || isMarkdown) {
		groups.push(
			`<button type="button" class="bf-btn" data-copy="content" data-href="${escapeHtml(rawHref)}" title="Copy the file contents">copy contents</button>`,
		);
	}
	groups.push(
		`<button type="button" class="bf-btn" data-copy="path" data-value="${escapeHtml(page.rel)}" title="Copy the root-relative path">copy path</button>`,
	);
	return `<span class="bf-card__actions">${groups.join("")}</span>`;
}

/** Render a file page (text, Markdown, image, binary, or over-size). */
export function renderFilePage(page: FilePage): string {
	const name = page.rel.slice(page.rel.lastIndexOf("/") + 1);
	const spec = languageOf(name);
	const language = page.file.kind === "text" ? detectLanguage(name) : undefined;
	// Text is always served as octet-stream, so the response type says nothing
	// about the file; the language label, size, and date are the useful metadata.
	const meta = `${spec.label} · ${formatSize(page.file.size)} · ${formatDate(page.file.mtimeMs)}`;
	const download = `<a class="bf-btn" href="/raw/${encodePath(page.rel)}" download>download</a>`;
	const head = `<div class="bf-card__head">${iconMarkup(spec)}<h1 class="bf-card__title">${escapeHtml(name)}</h1><span class="bf-card__meta">${escapeHtml(meta)}</span><span class="bf-spacer"></span>${renderFileActions(page)}${download}</div>`;

	const isMarkdown = page.file.kind === "markdown";
	const rendered = isMarkdown && !page.markdownRaw;
	const wrappable = page.file.kind === "text" || (isMarkdown && page.markdownRaw);
	const keys = pageKeys(
		...(isMarkdown ? [{ keys: "r", label: "Toggle rendered and raw" }] : []),
		...(wrappable ? [{ keys: "u", label: "Toggle line wrapping" }] : []),
	);

	let content: string;
	let note = "";
	if (page.file.kind === "text" || page.file.kind === "markdown") {
		if (page.file.kind === "markdown" && !page.markdownRaw) {
			const html = renderMarkdown(page.file.lines.join("\n"), markdownBaseDir(page.rel), {
				html: page.markdownHtml !== false,
			});
			content = `<article class="bf-md">${html}</article>`;
		} else {
			content = `<pre class="bf-code bf-code--numbered"><code>${renderCodeLines(page.file.lines, language)}</code></pre>`;
		}
		if (page.file.truncated)
			note = `<p class="bf-note">Showing the first ${page.file.lines.length} of ${page.file.totalLines} lines.</p>`;
	} else if (page.file.kind === "image") {
		content = `<div class="bf-media"><img src="/raw/${encodePath(page.rel)}" alt="${escapeHtml(name)}"></div>`;
	} else if (page.file.kind === "tooLarge") {
		content = `<div class="bf-empty"><p class="bf-empty__title">File is ${escapeHtml(formatSize(page.file.size))}.</p><p class="bf-empty__sub">Larger than the ${escapeHtml(formatSize(page.maxFileBytes))} inline limit.</p>${download}</div>`;
	} else {
		content = `<div class="bf-empty"><p class="bf-empty__title">Looks like a binary file.</p><p class="bf-empty__sub">${escapeHtml(formatSize(page.file.size))} · ${escapeHtml(page.file.mime)}</p>${download}</div>`;
	}

	return renderLayout({
		title: `browse · ${page.rel}`,
		rootLabel: page.rootLabel,
		tree: page.tree,
		currentRel: page.rel,
		breadcrumbs: renderBreadcrumbs(page.rel),
		mainClass: rendered ? "browse-page browse-measure" : "browse-page",
		keys,
		main: `    <div class="bf-card">${head}${content}</div>\n    ${note}`,
		footerNote: page.rel,
		git: page.git,
		summary: page.summary,
	});
}

/** Map a status letter to an accessible label. */
const STATUS_LABEL: Record<string, string> = {
	M: "modified",
	A: "added",
	D: "deleted",
	R: "renamed",
	C: "copied",
	T: "type changed",
	U: "unmerged",
	"?": "untracked",
};

function statusWord(letter: string): string {
	return STATUS_LABEL[letter] ?? "changed";
}

/**
 * The inner HTML per diff line. Hunk bodies are highlighted by rebuilding the
 * old side (context + deleted) and the new side (context + added), so the
 * tokenizer carries state within a hunk; meta, hunk, and note lines stay plain.
 * State does not cross hunks, since the unchanged lines between them are absent.
 */
function highlightDiffText(lines: DiffLine[], language?: HighlightLanguage): string[] {
	if (!language) return lines.map((line) => escapeHtml(line.text));
	const out: string[] = new Array(lines.length);
	let index = 0;
	while (index < lines.length) {
		const kind = lines[index].kind;
		if (kind !== "ctx" && kind !== "add" && kind !== "del") {
			out[index] = escapeHtml(lines[index].text);
			index++;
			continue;
		}
		const start = index;
		const oldDoc: string[] = [];
		const newDoc: string[] = [];
		while (index < lines.length) {
			const body = lines[index].kind;
			if (body !== "ctx" && body !== "add" && body !== "del") break;
			if (body === "ctx") {
				oldDoc.push(lines[index].text);
				newDoc.push(lines[index].text);
			} else if (body === "add") {
				newDoc.push(lines[index].text);
			} else {
				oldDoc.push(lines[index].text);
			}
			index++;
		}
		const oldHtml = highlightLines(oldDoc, language);
		const newHtml = highlightLines(newDoc, language);
		let oldIndex = 0;
		let newIndex = 0;
		for (let cursor = start; cursor < index; cursor++) {
			const body = lines[cursor].kind;
			if (body === "ctx") {
				out[cursor] = newHtml[newIndex];
				newIndex++;
				oldIndex++;
			} else if (body === "add") {
				out[cursor] = newHtml[newIndex];
				newIndex++;
			} else {
				out[cursor] = oldHtml[oldIndex];
				oldIndex++;
			}
		}
	}
	return out;
}

/** Render unified-diff lines with a two-column gutter and per-kind styling. */
export function renderDiffLines(lines: DiffLine[], language?: HighlightLanguage): string {
	const html = highlightDiffText(lines, language);
	// Every hunk is a section so its sticky header is bounded by its own body;
	// the section also gives the keyboard a stable, non-sticky scroll target.
	const out: string[] = [];
	let hunks = 0;
	let open = false;
	lines.forEach((line, index) => {
		if (line.kind === "hunk") {
			if (open) out.push("</span>");
			hunks += 1;
			out.push(`<span class="bf-diff-hunk" id="hunk-${hunks}" data-hunk="${hunks}">`);
			open = true;
		}
		const sign = line.kind === "add" ? "+" : line.kind === "del" ? "-" : line.kind === "ctx" ? " " : "";
		const gutter = `<span class="browse-diff-no" aria-hidden="true">${line.oldNo ?? ""}</span><span class="browse-diff-no" aria-hidden="true">${line.newNo ?? ""}</span>`;
		const marker = `<span class="browse-diff-sign" aria-hidden="true">${sign}</span>`;
		out.push(
			`<span class="bf-code__line bf-diff-line bf-diff-line--${line.kind}">${gutter}${marker}${html[index]}</span>`,
		);
	});
	if (open) out.push("</span>");
	return out.join("");
}

/** The scope label for a mode. */
function modeScope(mode: DiffMode): string {
	if (mode === "staged") return "staged vs HEAD";
	if (mode === "worktree") return "unstaged";
	return "vs HEAD";
}

/** The `head | staged | worktree` segmented control; `build` returns each href. */
function renderModeControl(mode: DiffMode, build: (mode: DiffMode) => string): string {
	const items = DIFF_MODES.map((candidate) => {
		const current = candidate === mode ? ` aria-current="page"` : "";
		return `<a class="bf-segmented__item" href="${escapeHtml(build(candidate))}"${current}>${candidate}</a>`;
	}).join("");
	return `<span class="bf-segmented" role="group" aria-label="Diff mode">${items}</span>`;
}

export interface DiffPage {
	rootLabel: string;
	mode: DiffMode;
	files: ChangedFile[];
	stat: string;
	tree: TreeNode;
	git?: GitStatus;
	summary?: ChangeSummary;
}

/** The change overview: `git diff --stat` plus every changed path. */
export function renderDiffPage(page: DiffPage): string {
	const modeHref = (mode: DiffMode) => (mode === "head" ? "/diff" : `/diff?mode=${mode}`);
	const body =
		page.files.length === 0
			? `<div class="bf-empty"><p class="bf-empty__title">No changes ${escapeHtml(modeScope(page.mode))}.</p><p class="bf-empty__sub">The working tree matches this scope.</p></div>`
			: `<table class="bf-table browse-diff" aria-labelledby="page-title">
<thead><tr><th scope="col" class="browse-diff-status">Status</th><th scope="col">Path</th><th scope="col" class="browse-diff-word">Changes</th></tr></thead>
<tbody>
${page.files.map((file) => renderChangedRow(file, page.mode)).join("\n")}
</tbody>
</table>`;
	const stat = page.stat ? `<pre class="browse-diff-stat">${escapeHtml(page.stat)}</pre>` : "";
	return renderLayout({
		title: "browse · changes",
		rootLabel: page.rootLabel,
		tree: page.tree,
		currentRel: "",
		breadcrumbs: renderBreadcrumbs(""),
		mainClass: "browse-page",
		keys: pageKeys(),
		main: `    <h1 class="bf-title browse-heading" id="page-title">Changes <span class="browse-diff-scope">${escapeHtml(modeScope(page.mode))}</span></h1>\n    <div class="browse-diff-toolbar">${renderModeControl(page.mode, modeHref)}</div>\n    ${stat}\n    ${body}`,
		footerNote: `${page.files.length} changed`,
		git: page.git,
		summary: page.summary,
	});
}

function renderChangedRow(file: ChangedFile, mode: DiffMode): string {
	const letter = statusLetter(file);
	const label = statusWord(letter);
	const badge = `browse-diff-badge browse-diff-badge--${letter === "?" ? "Q" : letter}`;
	const orig = file.origRel ? ` <span class="browse-diff-orig">from ${escapeHtml(file.origRel)}</span>` : "";
	const href = `/diff/${encodePath(file.rel)}${mode === "head" ? "" : `?mode=${mode}`}`;
	return `<tr data-path="${escapeHtml(file.rel)}"><td><span class="${badge}" aria-label="${escapeHtml(label)}">${escapeHtml(letter)}</span></td><td><span class="bf-table__name">${iconMarkup(languageOf(file.rel))}<a href="${href}">${escapeHtml(file.rel)}</a>${orig}</span></td><td class="browse-diff-word">${escapeHtml(label)}</td></tr>`;
}

export interface FileDiffPage {
	rootLabel: string;
	rel: string;
	mode: DiffMode;
	diff: DiffFileView;
	tree: TreeNode;
	git?: GitStatus;
	summary?: ChangeSummary;
}

/** A single file's unified diff, with the scope control and file actions. */
export function renderFileDiffPage(page: FileDiffPage): string {
	const name = page.rel.slice(page.rel.lastIndexOf("/") + 1);
	const spec = languageOf(name);
	const base = `/diff/${encodePath(page.rel)}`;
	const actions = [
		renderModeControl(page.mode, (mode) => (mode === "head" ? base : `${base}?mode=${mode}`)),
		`<a class="bf-btn" href="/view/${encodePath(page.rel)}" title="Open the file">view file</a>`,
		`<button type="button" class="bf-btn" id="wrap-toggle" aria-pressed="false" title="Toggle line wrapping">wrap</button>`,
		`<a class="bf-btn" href="/raw/${encodePath(page.rel)}" download>download</a>`,
		`<button type="button" class="bf-btn" data-copy="path" data-value="${escapeHtml(page.rel)}" title="Copy the root-relative path">copy path</button>`,
	];
	// A per-file change summary and hunk count, so the scope is visible before scrolling.
	const adds = page.diff.lines.filter((line) => line.kind === "add").length;
	const dels = page.diff.lines.filter((line) => line.kind === "del").length;
	const hunks = page.diff.lines.filter((line) => line.kind === "hunk").length;
	const summary =
		hunks > 0
			? `<span class="bf-card__meta browse-diff-summary"><span class="browse-diff-add">+${adds}</span> <span class="browse-diff-del">−${dels}</span></span><span class="bf-card__meta browse-hunks">${hunks} hunk${hunks === 1 ? "" : "s"}</span>`
			: "";
	const keys = pageKeys(
		{ keys: "u", label: "Toggle line wrapping" },
		...(hunks > 0 ? [{ keys: "n p", label: "Next and previous change" }] : []),
	);
	const head = `<div class="bf-card__head">${iconMarkup(spec)}<h1 class="bf-card__title">${escapeHtml(name)}</h1><span class="bf-card__meta">${escapeHtml(modeScope(page.mode))}</span>${summary}<span class="bf-spacer"></span><span class="bf-card__actions">${actions.join("")}</span></div>`;
	let content: string;
	let note = "";
	if (page.diff.binary) {
		content = `<div class="bf-empty"><p class="bf-empty__title">Binary or unreadable change.</p><p class="bf-empty__sub">No text diff is shown for this file.</p><a class="bf-btn" href="/raw/${encodePath(page.rel)}" download>download</a></div>`;
	} else if (page.diff.lines.length === 0) {
		content = `<div class="bf-empty"><p class="bf-empty__title">No changes for this file.</p><p class="bf-empty__sub">It is unchanged in the selected scope.</p></div>`;
	} else {
		content = `<pre class="bf-code bf-diff"><code>${renderDiffLines(page.diff.lines, detectLanguage(name))}</code></pre>`;
		if (page.diff.truncated) note = `<p class="bf-note">Showing the first ${page.diff.lines.length} diff lines.</p>`;
	}
	return renderLayout({
		title: `browse · ${page.rel}`,
		rootLabel: page.rootLabel,
		tree: page.tree,
		currentRel: page.rel,
		breadcrumbs: renderBreadcrumbs(page.rel),
		mainClass: "browse-page",
		keys,
		main: `    <div class="bf-card">${head}${content}</div>\n    ${note}`,
		footerNote: `diff · ${modeScope(page.mode)}`,
		git: page.git,
		summary: page.summary,
	});
}

export interface ErrorPage {
	rootLabel: string;
	status: number;
	message: string;
	tree: TreeNode;
	git?: GitStatus;
}

/** Render a status/error page with the same chrome. */
export function renderErrorPage(page: ErrorPage): string {
	return renderLayout({
		title: `browse · ${page.status}`,
		rootLabel: page.rootLabel,
		tree: page.tree,
		currentRel: "",
		breadcrumbs: renderBreadcrumbs(""),
		main: `    <div class="bf-empty"><div class="bf-empty__code">${page.status}</div><p class="bf-empty__title">${escapeHtml(page.message)}</p><p class="bf-empty__sub"><a href="/browse/">back to the served folder</a></p></div>`,
		footerNote: "error",
		git: page.git,
	});
}
