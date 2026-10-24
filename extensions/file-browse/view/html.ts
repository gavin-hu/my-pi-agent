/**
 * HTML rendering for the browse pages.
 *
 * Pure string building: the router reads the filesystem and hands these
 * renderers plain view models. Everything user-controlled is escaped, links are
 * percent-encoded per segment, and the only script is the same-origin
 * `/app.js`. The shared Bytefly shell and components come from `lib/web`, and
 * the page-only `browse-*` rules from `styles.ts`.
 */

import { brandLockup, docHead, type KeyHint, keysSheet, themeToggle } from "../../../lib/web/index.ts";
import { escapeHtml } from "../../../lib/escape.ts";
import { renderChanges, renderGit, renderLiveChrome, renderLiveStatus, type LivePage } from "./chrome.ts";
import { type DirEntry, type FileView, type Listing, type TreeNode } from "../files/files.ts";
import { formatSize } from "../../../lib/format.ts";
import { DIFF_MODES, statusLetter, type ChangedFile, type DiffMode } from "../text/diff.ts";
import { renderDiffLines } from "./diff-html.ts";
import type { DiffFileView, GitStatus } from "../git/git.ts";
import type { ChangeIndex } from "../live/live.ts";
import { detectLanguage, highlightLines, type HighlightLanguage } from "../../../lib/highlight.ts";
import { FOLDER_ICON, iconHref, languageOf, SPRITE, type IconSpec } from "./icons.ts";
import { renderMarkdown } from "./markdown.ts";
import { encodePath } from "../files/paths.ts";
import { BROWSE_CSS } from "./styles.ts";

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

/**
 * The changed-path index for markers, plus the totals shown in the chip. It is
 * the same index the live status feed sends, so the page and its updates agree
 * on what "changed" means.
 */
export type ChangeSummary = ChangeIndex;

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

function hrefFor(entry: { rel: string; isDir: boolean }): string {
	return entry.isDir ? `/browse/${encodePath(entry.rel)}` : `/view/${encodePath(entry.rel)}`;
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
	/** Live status chrome; omitted when the channel is off. */
	live?: LivePage;
}

/** A full two-pane page. */
function renderLayout(layout: Layout): string {
	return `<!doctype html>
<html lang="en">
<head>
${docHead({ title: layout.title, css: BROWSE_CSS })}
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
  ${renderChanges(layout.summary, layout.live)}
  <span class="bf-chip bf-chip--accent">read-only</span>
  ${renderLiveChrome(layout.live)}
  <button type="button" class="bf-btn bf-btn--icon browse-keys-btn" id="keys-open" aria-label="Keyboard shortcuts" title="Keyboard shortcuts">?</button>
  ${themeToggle()}
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
<footer class="bf-app__footer">${layout.live ? renderLiveStatus() : ""}served from ${escapeHtml(layout.rootLabel)} · read-only · ${escapeHtml(layout.footerNote)}</footer>
${layout.keys && layout.keys.length > 0 ? keysSheet(layout.keys) : ""}
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
		? `<button type="button" class="bf-tree__tw bf-tree__tw--toggle" tabindex="-1" aria-hidden="true">${expanded ? "▾" : "▸"}</button>`
		: `<span class="bf-tree__tw bf-tree__tw--spacer" aria-hidden="true"></span>`;
	const dataPath = ` data-path="${escapeHtml(node.rel)}"`;
	const name = isDir ? `${escapeHtml(node.name)}/` : escapeHtml(node.name);
	const children = expanded
		? `<ul>${node.children.map((child) => renderTreeNode(child, currentRel, summary)).join("")}</ul>`
		: "";
	const label = node.broken
		? `<span class="browse-broken" title="broken symbolic link">${name}</span><span class="browse-link-mark">↩</span>`
		: isDir
			? `<a href="${href}" aria-expanded="${expanded}" title="${escapeHtml(node.rel)}">${name}</a>`
			: `<a href="${href}" title="${escapeHtml(node.rel)}">${name}</a>`;
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
		: `<a href="${hrefFor(entry)}" title="${escapeHtml(entry.rel)}">${name}</a>`;
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
	/** Live status chrome; omitted when the channel is off. */
	live?: LivePage;
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
		live: page.live,
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
	/** Live status chrome; omitted when the channel is off. */
	live?: LivePage;
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

/** Whether the page renders lines with a number beside them: plain text, or raw Markdown. */
function numberedLines(page: FilePage): boolean {
	return page.file.kind === "text" || (page.file.kind === "markdown" && page.markdownRaw === true);
}

/** The card-head controls: Markdown mode, line wrapping, and the copy actions,
 * plus the download the diff head keeps in the same group. */
function renderFileActions(page: FilePage, download: string): string {
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
	if (numberedLines(page)) {
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
	if (numberedLines(page)) {
		groups.push(
			`<button type="button" class="bf-btn" id="copy-reference" disabled title="Select lines in the file first">copy reference</button>`,
		);
	}
	return `<span class="bf-card__actions">${groups.join("")}${download}</span>`;
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
	const head = `<div class="bf-card__head">${iconMarkup(spec)}<h1 class="bf-card__title">${escapeHtml(name)}</h1><span class="bf-card__meta">${escapeHtml(meta)}</span><span class="bf-spacer"></span>${renderFileActions(page, download)}</div>`;

	const isMarkdown = page.file.kind === "markdown";
	const rendered = isMarkdown && !page.markdownRaw;
	const numbered = numberedLines(page);
	const keys = pageKeys(
		...(isMarkdown ? [{ keys: "r", label: "Toggle rendered and raw" }] : []),
		...(numbered ? [{ keys: "u", label: "Toggle line wrapping" }] : []),
		...(numbered ? [{ keys: "y", label: "Copy a reference to the selected lines" }] : []),
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
			content = `<pre class="bf-code bf-code--numbered" data-path="${escapeHtml(page.rel)}"><code>${renderCodeLines(page.file.lines, language)}</code></pre>`;
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
		live: page.live,
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
	/** Live status chrome; omitted when the channel is off. */
	live?: LivePage;
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
		live: page.live,
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
	/** Live status chrome; omitted when the channel is off. */
	live?: LivePage;
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
		live: page.live,
	});
}

export interface ErrorPage {
	rootLabel: string;
	status: number;
	message: string;
	tree: TreeNode;
	git?: GitStatus;
	/** Live status chrome; omitted when the channel is off. */
	live?: LivePage;
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
		live: page.live,
	});
}
