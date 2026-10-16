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
import { DIFF_MODES, statusLetter, type ChangedFile, type DiffLine, type DiffMode } from "./diff.ts";
import type { DiffFileView, GitStatus } from "./git.ts";
import { detectLanguage, highlightLines, type HighlightLanguage } from "../../lib/highlight.ts";
import { FOLDER_ICON, iconHref, languageOf, SPRITE, type IconSpec } from "./icons.ts";
import { renderMarkdownDocument, type MarkdownHeading } from "./markdown.ts";
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

/** The header's changes chip, linking to the diff overview when there are changes. */
function renderChanges(count: number | undefined): string {
	if (!count || count <= 0) return "";
	const label = `${count} change${count === 1 ? "" : "s"}`;
	const aria = `${label} against HEAD`;
	return `<a class="bf-chip browse-diff" href="/diff" title="View uncommitted changes" aria-label="${escapeHtml(aria)}"><span class="browse-diff__dot" aria-hidden="true">●</span>${escapeHtml(label)}</a>`;
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
.browse-md-outline{max-width:80ch;margin:0 0 var(--space-3) var(--space-4);border:1px solid var(--border);border-radius:var(--radius-md);font-size:var(--fs-sm)}
.browse-md-outline>summary{padding:var(--space-2) var(--space-3);cursor:pointer;color:var(--muted);font-family:var(--font-mono);font-size:var(--fs-xs)}
.browse-md-outline ul{list-style:none;margin:0;padding:0 var(--space-3) var(--space-2)}
.browse-md-outline a{display:block;padding:2px 0}
.browse-md-outline a.lvl1{padding-left:var(--space-3)}
.browse-md-outline a.lvl2{padding-left:var(--space-5)}
.browse-md-outline a.lvl3{padding-left:var(--space-7)}
body.palette-open{overflow:hidden}
.browse-diff{font-family:var(--font-mono);gap:5px}
.browse-diff:hover{color:var(--accent);text-decoration:none}
.browse-diff__dot{color:var(--warn);font-size:9px;line-height:1}
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
@media (max-width:520px){
.bf-toolbar .bf-theme-toggle{margin-left:auto}
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
	/** Number of changed files, for the header's changes chip; omitted when clean. */
	changes?: number;
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
  ${renderChanges(layout.changes)}
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
	/** Number of changed files, for the header's changes chip. */
	changes?: number;
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
		changes: page.changes,
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
	/** True when this file has uncommitted changes, for the changes action. */
	changed?: boolean;
	/** Number of changed files, for the header's changes chip. */
	changes?: number;
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

/** An "on this page" outline from the headings the Markdown renderer emitted. */
function renderOutline(headings: MarkdownHeading[]): string {
	if (headings.length < 4) return "";
	const base = Math.min(...headings.map((heading) => heading.level));
	const items = headings
		.map((heading) => {
			const depth = Math.min(heading.level - base, 3);
			const label = heading.text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_~]/g, "");
			return `<li><a class="lvl${depth}" href="#${heading.id}">${escapeHtml(label)}</a></li>`;
		})
		.join("");
	return `<details class="browse-md-outline"><summary>On this page</summary><ul>${items}</ul></details>`;
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
	const meta = `${spec.label} · ${formatSize(page.file.size)} · ${formatDate(page.file.mtimeMs)} · ${page.file.mime}`;
	const download = `<a class="bf-btn" href="/raw/${encodePath(page.rel)}" download>download</a>`;
	const head = `<div class="bf-card__head">${iconMarkup(spec)}<h1 class="bf-card__title">${escapeHtml(name)}</h1><span class="bf-card__meta">${escapeHtml(meta)}</span><span class="bf-spacer"></span>${renderFileActions(page)}${download}</div>`;

	let content: string;
	let note = "";
	if (page.file.kind === "text" || page.file.kind === "markdown") {
		if (page.file.kind === "markdown" && !page.markdownRaw) {
			const rendered = renderMarkdownDocument(page.file.lines.join("\n"), markdownBaseDir(page.rel));
			content = `${renderOutline(rendered.headings)}<article class="bf-md">${rendered.html}</article>`;
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
		main: `    <div class="bf-card">${head}${content}</div>\n    ${note}`,
		footerNote: escapeHtml(page.file.mime),
		git: page.git,
		changes: page.changes,
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

/** Render unified-diff lines with a two-column gutter and per-kind styling. */
export function renderDiffLines(lines: DiffLine[]): string {
	return lines
		.map((line) => {
			const sign = line.kind === "add" ? "+" : line.kind === "del" ? "-" : line.kind === "ctx" ? " " : "";
			const gutter = `<span class="browse-diff-no" aria-hidden="true">${line.oldNo ?? ""}</span><span class="browse-diff-no" aria-hidden="true">${line.newNo ?? ""}</span>`;
			const marker = `<span class="browse-diff-sign" aria-hidden="true">${sign}</span>`;
			return `<span class="bf-code__line bf-diff-line bf-diff-line--${line.kind}">${gutter}${marker}${escapeHtml(line.text)}</span>`;
		})
		.join("");
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
	changes?: number;
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
		main: `    <h1 class="bf-title browse-heading" id="page-title">Changes <span class="browse-diff-scope">${escapeHtml(modeScope(page.mode))}</span></h1>\n    <div class="browse-diff-toolbar">${renderModeControl(page.mode, modeHref)}</div>\n    ${stat}\n    ${body}`,
		footerNote: `${page.files.length} changed`,
		git: page.git,
		changes: page.changes,
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
	changes?: number;
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
	const head = `<div class="bf-card__head">${iconMarkup(spec)}<h1 class="bf-card__title">${escapeHtml(name)}</h1><span class="bf-card__meta">${escapeHtml(modeScope(page.mode))}</span><span class="bf-spacer"></span><span class="bf-card__actions">${actions.join("")}</span></div>`;
	let content: string;
	let note = "";
	if (page.diff.binary) {
		content = `<div class="bf-empty"><p class="bf-empty__title">Binary or unreadable change.</p><p class="bf-empty__sub">No text diff is shown for this file.</p><a class="bf-btn" href="/raw/${encodePath(page.rel)}" download>download</a></div>`;
	} else if (page.diff.lines.length === 0) {
		content = `<div class="bf-empty"><p class="bf-empty__title">No changes for this file.</p><p class="bf-empty__sub">It is unchanged in the selected scope.</p></div>`;
	} else {
		content = `<pre class="bf-code bf-diff"><code>${renderDiffLines(page.diff.lines)}</code></pre>`;
		if (page.diff.truncated) note = `<p class="bf-note">Showing the first ${page.diff.lines.length} diff lines.</p>`;
	}
	return renderLayout({
		title: `browse · ${page.rel}`,
		rootLabel: page.rootLabel,
		tree: page.tree,
		currentRel: page.rel,
		breadcrumbs: renderBreadcrumbs(page.rel),
		main: `    <div class="bf-card">${head}${content}</div>\n    ${note}`,
		footerNote: `diff · ${escapeHtml(modeScope(page.mode))}`,
		git: page.git,
		changes: page.changes,
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
