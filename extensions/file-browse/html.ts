/**
 * HTML rendering for the browse pages.
 *
 * Pure string building: the router reads the filesystem and hands these
 * renderers plain view models. Everything user-controlled is escaped, links are
 * percent-encoded per segment, and the only script is the same-origin
 * `/app.js`. The shared Bytefly shell and components come from `lib/web`; the
 * `browse-*` rules below are the page-only layer.
 */

import { GLYPHS } from "../../lib/ui.ts";
import {
	brandLockup,
	docHead,
	WEB_BASE_CSS,
	WEB_COMPONENTS_CSS,
	WEB_LAYOUT_CSS,
	WEB_THEME_CSS,
} from "../../lib/web/index.ts";
import { escapeHtml } from "../../lib/escape.ts";
import { formatSize, type DirEntry, type FileView, type Listing, type TreeNode } from "./files.ts";
import type { GitStatus } from "./git.ts";
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

/** The header's git chip: branch (or detached head) plus a dirty dot. */
function renderGit(git: GitStatus | undefined): string {
	if (!git) return "";
	const name = git.branch ?? git.head;
	if (!name) return "";
	const glyph = git.branch ? GLYPHS.branch : GLYPHS.detached;
	const aria = `${git.branch ? `git branch ${git.branch}` : `git detached at ${git.head ?? ""}`}${git.dirty ? ", uncommitted changes" : ""}`;
	const dot = git.dirty ? `<span class="browse-dirty" aria-hidden="true" title="uncommitted changes">●</span>` : "";
	return `<span class="bf-chip browse-git${git.dirty ? " browse-git--dirty" : ""}" title="${escapeHtml(aria)}" aria-label="${escapeHtml(aria)}"><span class="browse-git__glyph" aria-hidden="true">${escapeHtml(glyph)}</span>${escapeHtml(name)}${dot}</span>`;
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
.browse-git--dirty .browse-git__glyph{color:var(--warn)}
.browse-dirty{color:var(--warn);font-size:9px;line-height:1}
.browse-quick-open{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);width:100%;margin-bottom:var(--space-2);padding:6px var(--space-2);border:1px solid var(--border);border-radius:var(--radius-md);background:var(--canvas);color:var(--muted);font:var(--fs-sm) var(--font-ui);cursor:pointer}
.browse-quick-open:hover{border-color:var(--accent);color:var(--accent)}
.browse-quick-open kbd{font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--dim)}
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
@media (max-width:720px){
  .browse-cat.doc{color:var(--muted)}
}`;

interface Layout {
	title: string;
	rootLabel: string;
	tree: TreeNode;
	currentRel: string;
	breadcrumbs: string;
	main: string;
	footerNote: string;
	git?: GitStatus;
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
<noscript><style>.bf-field{display:none}.bf-tree__tw--toggle{visibility:hidden}.bf-btn{display:none}.browse-quick-open{display:none}th .bf-sort{pointer-events:none;cursor:default}</style></noscript>
${SPRITE}
<header class="bf-app__header"><div class="bf-toolbar">
  ${brandLockup("browse")}
  <span class="bf-context browse-root">${escapeHtml(layout.rootLabel)}</span>
  ${renderGit(layout.git)}
  <span class="bf-chip bf-chip--accent">read-only</span>
  <button type="button" class="bf-btn bf-btn--icon bf-theme-toggle" id="theme-toggle" aria-label="Toggle light and dark theme" title="Toggle light and dark theme"><span class="theme-glyph" aria-hidden="true">☾</span></button>
</div></header>
<div class="bf-app__body">
  <details class="bf-app__sidebar" open>
    <summary class="bf-panel__summary">Files</summary>
    <aside class="bf-panel browse-side">
      <button type="button" class="browse-quick-open" id="quick-open" aria-haspopup="dialog"><span>quick open</span><kbd>/</kbd></button>
      <label class="bf-field">⌕ <input class="bf-input" id="filter" type="search" placeholder="filter paths…" aria-label="Filter paths"></label>
      <nav class="bf-tree" aria-label="File tree">${renderTree(layout.tree, layout.currentRel)}</nav>
      <p class="bf-note" id="tree-empty" hidden>No matches.</p>
    </aside>
  </details>
  <main class="bf-app__main" id="main" tabindex="-1">
    <nav class="bf-crumbs" aria-label="Breadcrumb">${layout.breadcrumbs}</nav>
${layout.main}
  </main>
</div>
<footer class="bf-app__footer">served from ${escapeHtml(layout.rootLabel)} · read-only · ${layout.footerNote}</footer>
<script src="/app.js" defer></script>
</body>
</html>
`;
}

/** The breadcrumb trail for a root-relative path. */
export function renderBreadcrumbs(rel: string): string {
	const segments = rel.split("/").filter(Boolean);
	const parts = [`<a href="/browse/">home</a>`];
	let accumulated = "";
	segments.forEach((segment, index) => {
		accumulated = accumulated ? `${accumulated}/${segment}` : segment;
		if (index === segments.length - 1) {
			parts.push(`<span aria-current="page">${escapeHtml(segment)}</span>`);
		} else {
			parts.push(`<a href="/browse/${encodePath(accumulated)}">${escapeHtml(segment)}</a>`);
		}
	});
	if (segments.length === 0) parts[0] = `<span aria-current="page">home</span>`;
	return parts.join(`<span class="bf-crumbs__sep">/</span>`);
}

function renderTree(node: TreeNode, currentRel: string): string {
	return `<ul>${renderTreeNode(node, currentRel)}</ul>`;
}

function renderTreeNode(node: TreeNode, currentRel: string): string {
	const expanded = node.children.length > 0;
	const isDir = node.isDir;
	const spec = isDir ? FOLDER_ICON : languageOf(node.name);
	const href = isDir ? (node.rel ? `/browse/${encodePath(node.rel)}` : "/browse/") : `/view/${encodePath(node.rel)}`;
	const current = node.rel === currentRel ? ` aria-current="page"` : "";
	const twisty = isDir
		? `<button type="button" class="bf-tree__tw bf-tree__tw--toggle" aria-expanded="${expanded}" aria-label="${escapeHtml(node.name)}">${expanded ? "▾" : "▸"}</button>`
		: `<span class="bf-tree__tw bf-tree__tw--spacer" aria-hidden="true"></span>`;
	const dataPath = ` data-path="${escapeHtml(node.rel)}"`;
	const name = isDir ? `${escapeHtml(node.name)}/` : escapeHtml(node.name);
	const children = expanded
		? `<ul>${node.children.map((child) => renderTreeNode(child, currentRel)).join("")}</ul>`
		: "";
	const label = node.broken
		? `<span class="browse-broken" title="broken symbolic link">${name}</span><span class="browse-link-mark">↩</span>`
		: `<a href="${href}">${name}</a>`;
	return `<li data-open="${expanded}"><div class="bf-tree__row"${current}${dataPath}>${twisty}${iconMarkup(spec)}${label}</div>${children}</li>`;
}

function renderRow(entry: DirEntry, maxThumbBytes: number, thumbnails: boolean): string {
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
	return `<tr${classes ? ` class="${classes}"` : ""} ${attrs}><td><span class="bf-table__name">${visual}${link}${mark}</span></td><td class="bf-table__size">${entry.isDir ? "—" : escapeHtml(formatSize(entry.size))}</td><td class="bf-table__when">${entry.isDir ? "—" : escapeHtml(formatDate(entry.mtimeMs))}</td></tr>`;
}

export interface DirectoryPage {
	rootLabel: string;
	rel: string;
	listing: Listing;
	tree: TreeNode;
	thumbnails: boolean;
	maxThumbBytes: number;
	git?: GitStatus;
}

/** Render a directory listing page. */
export function renderDirectoryPage(page: DirectoryPage): string {
	const folderName = page.rel ? page.rel.slice(page.rel.lastIndexOf("/") + 1) : "/";
	const heading = `<h1 class="bf-title browse-heading" id="page-title">${escapeHtml(folderName)}</h1>`;
	let body = `<table class="bf-table browse-listing" aria-labelledby="page-title">
<thead><tr><th scope="col" aria-sort="ascending"><button type="button" class="bf-sort" data-sort="name" title="Sort by name">Name</button></th><th scope="col" class="bf-table__size"><button type="button" class="bf-sort" data-sort="size" title="Sort by size">Size</button></th><th scope="col" class="bf-table__when"><button type="button" class="bf-sort" data-sort="mtime" title="Sort by modified time">Modified</button></th></tr></thead>
<tbody>
${page.listing.entries.map((entry) => renderRow(entry, page.maxThumbBytes, page.thumbnails)).join("\n")}
</tbody>
</table>`;
	if (page.listing.entries.length === 0) body = `<div class="bf-empty">This folder is empty.</div>`;
	else if (page.listing.truncated)
		body += `<p class="bf-note">Showing the first ${page.listing.entries.length} of ${page.listing.total} entries.</p>`;

	return renderLayout({
		title: `browse · ${page.rel || "/"}`,
		rootLabel: page.rootLabel,
		tree: page.tree,
		currentRel: page.rel,
		breadcrumbs: renderBreadcrumbs(page.rel),
		main: `    ${heading}\n    ${body}`,
		footerNote: `${page.listing.total} entr${page.listing.total === 1 ? "y" : "ies"}`,
		git: page.git,
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

/** The card-head controls: Markdown mode, line wrapping, and copy actions. */
function renderFileActions(page: FilePage): string {
	const isMarkdown = page.file.kind === "markdown";
	const rawHref = `/raw/${encodePath(page.rel)}`;
	const viewHref = `/view/${encodePath(page.rel)}`;
	const groups: string[] = [];
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
			`<button type="button" class="bf-btn" data-copy="content" data-href="${escapeHtml(rawHref)}" title="Copy the file contents">copy</button>`,
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
	const meta = `${spec.label} · ${formatSize(page.file.size)} · ${formatDate(page.file.mtimeMs)} · ${page.file.mime}`;
	const download = `<a class="bf-btn" href="/raw/${encodePath(page.rel)}" download>download</a>`;
	const head = `<div class="bf-card__head">${iconMarkup(spec)}<h1 class="bf-card__title">${escapeHtml(name)}</h1><span class="bf-card__meta">${escapeHtml(meta)}</span><span class="bf-spacer"></span>${renderFileActions(page)}${download}</div>`;

	let content: string;
	let note = "";
	if (page.file.kind === "text" || page.file.kind === "markdown") {
		content =
			page.file.kind === "markdown" && !page.markdownRaw
				? `<div class="bf-md">${renderMarkdown(page.file.lines.join("\n"), markdownBaseDir(page.rel))}</div>`
				: `<pre class="bf-code bf-code--numbered"><code>${renderCodeLines(page.file.lines, language)}</code></pre>`;
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
		main: `    <div class="bf-card">${head}${content}</div>\n    ${note}`,
		footerNote: escapeHtml(page.file.mime),
		git: page.git,
	});
}

export interface ErrorPage {
	rootLabel: string;
	status: number;
	message: string;
	tree: TreeNode;
	rel: string;
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
