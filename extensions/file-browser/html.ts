/**
 * HTML rendering for the serve pages.
 *
 * Pure string building: the router reads the filesystem and hands these
 * renderers plain view models. Everything user-controlled is escaped, links are
 * percent-encoded per segment, and the only script is the same-origin
 * `/app.js`. The two-pane layout, thumbnails, and icons all live here and in
 * `client.ts`.
 */

import { GLYPHS } from "../../lib/ui.ts";
import { formatSize, type DirEntry, type FileView, type Listing, type TreeNode } from "./files.ts";
import type { GitStatus } from "./git.ts";
import { FOLDER_ICON, iconHref, languageOf, SPRITE, type IconSpec } from "./icons.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Escape text for an HTML text node or double-quoted attribute. */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&#39;";
		}
	});
}

/** Percent-encode each path segment, keeping `/` separators. */
export function encodePath(rel: string): string {
	return rel.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

/** A short local date like `Oct 8 20:31`. */
export function formatDate(ms: number): string {
	const date = new Date(ms);
	if (Number.isNaN(date.getTime())) return "—";
	const hh = String(date.getHours()).padStart(2, "0");
	const mm = String(date.getMinutes()).padStart(2, "0");
	return `${MONTHS[date.getMonth()]} ${date.getDate()} ${hh}:${mm}`;
}

function iconMarkup(spec: IconSpec, hidden = false): string {
	return `<svg class="cat ${spec.colorClass}"${hidden ? " hidden" : ""} aria-hidden="true" title="${escapeHtml(spec.label)}"><use href="${iconHref(spec.icon)}"/></svg>`;
}

/** The header's git chip: branch (or detached head) plus a dirty dot. */
function renderGit(git: GitStatus | undefined): string {
	if (!git) return "";
	const name = git.branch ?? git.head;
	if (!name) return "";
	const glyph = git.branch ? GLYPHS.branch : GLYPHS.detached;
	const aria = `${git.branch ? `git branch ${git.branch}` : `git detached at ${git.head ?? ""}`}${git.dirty ? ", uncommitted changes" : ""}`;
	const dot = git.dirty ? `<span class="dirty-dot" aria-hidden="true" title="uncommitted changes">●</span>` : "";
	return `<span class="git${git.dirty ? " dirty" : ""}" title="${escapeHtml(aria)}" aria-label="${escapeHtml(aria)}"><span class="glyph" aria-hidden="true">${glyph}</span>${escapeHtml(name)}${dot}</span>`;
}

function hrefFor(entry: { rel: string; isDir: boolean }): string {
	return entry.isDir ? `/browse/${encodePath(entry.rel)}` : `/view/${encodePath(entry.rel)}`;
}

const STYLES = `:root{
  --canvas:#0d1117;--surface:#161b22;--border:#30363d;--text:#c9d1d9;
  --muted:#8b949e;--accent:#58a6ff;--accent-soft:rgba(88,166,255,.15);
  --success:#3fb950;--danger:#f85149;--warn:#d29922;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --ui:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  color-scheme:dark light;
}
@media (prefers-color-scheme:light){:root{
  --canvas:#fff;--surface:#f6f8fa;--border:#d0d7de;--text:#1f2328;--muted:#656d76;
  --accent:#0969da;--accent-soft:rgba(9,105,218,.10);--success:#1a7f37;
  --danger:#cf222e;--warn:#9a6700;}}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--canvas);color:var(--text);font:15px/1.5 var(--ui)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
a:focus-visible,button:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.skip{position:absolute;left:-9999px;top:0;z-index:3;padding:8px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:6px}
.skip:focus{left:12px;top:12px}
header.site{position:sticky;top:0;z-index:2;background:var(--surface);border-bottom:1px solid var(--border)}
.bar{display:flex;align-items:center;gap:12px;height:56px;padding:0 24px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--accent);flex:0 0 8px}
.brand{display:flex;align-items:center;gap:8px;font-weight:600}
.root{flex:1 1 auto;min-width:0;font-family:var(--mono);color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.badge{margin-left:auto;font-size:12px;color:var(--success);border:1px solid currentColor;border-radius:999px;padding:2px 10px;white-space:nowrap}
.git{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:12.5px;color:var(--muted);white-space:nowrap}
.git.dirty .glyph{color:var(--warn)}
.git .dirty-dot{color:var(--warn);font-size:9px;line-height:1}
.shell{display:grid;grid-template-columns:260px 1fr;min-height:calc(100vh - 56px - 44px)}
details.side-panel{position:sticky;top:56px;align-self:start;max-height:calc(100vh - 56px);overflow-y:auto;overscroll-behavior:contain;background:var(--surface);border-right:1px solid var(--border);min-width:0}
.side-summary{display:none}
aside.side{padding:14px 12px;min-width:0}
.filter{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:6px;background:var(--canvas);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--muted);font-size:13px}
.filter input{border:0;background:transparent;color:var(--text);font:13px var(--mono);width:100%;outline:none}
nav.tree{margin-top:12px;font-family:var(--mono);font-size:13px;overflow-x:auto}
nav.tree ul{list-style:none;margin:0;padding-left:14px}
nav.tree>ul{padding-left:0}
nav.tree .row{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:4px;white-space:nowrap}
nav.tree .row:hover{background:var(--accent-soft)}
nav.tree .row[aria-current]{background:var(--accent-soft);color:var(--text);font-weight:600}
nav.tree .tw{position:relative;appearance:none;background:none;border:0;padding:0;margin:0;width:12px;height:16px;flex:0 0 12px;font:inherit;line-height:1;text-align:center;color:var(--muted);cursor:pointer}
nav.tree .tw.toggle::after{content:"";position:absolute;inset:-6px -3px}
nav.tree .tw.spacer{cursor:default}
nav.tree li[data-loading] .tw{opacity:.5}
nav.tree li[data-error]>.row{color:var(--danger)}
nav.tree li[data-error] .tw{color:var(--danger)}
nav.tree .cat{width:16px;height:16px;flex:0 0 16px}
main.content{padding:20px 24px;min-width:0;max-width:1400px;justify-self:start}
nav.crumbs{font-family:var(--mono);font-size:13px;color:var(--muted);padding-bottom:10px;overflow-wrap:anywhere}
nav.crumbs .sep{padding:0 6px}
nav.crumbs [aria-current]{color:var(--text);font-weight:600}
table.listing{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}
th.size,td.size{width:96px}
th.when,td.when{width:140px}
caption{text-align:left;font-size:12px;color:var(--muted);padding-bottom:8px;text-transform:uppercase;letter-spacing:.04em}
th{font-weight:500;color:var(--muted);text-align:left;padding:6px 10px;border-bottom:1px solid var(--border);font-size:12px}
td{padding:6px 10px;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
tbody tr:hover{background:var(--accent-soft)}
.name{display:flex;align-items:center;gap:10px;min-width:0}
.name a{flex:1 1 auto;min-width:0;font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cat{width:16px;height:16px;flex:0 0 16px;color:var(--accent)}
.cat.doc{color:var(--muted)}.cat.img{color:var(--success)}.cat.cfg{color:var(--warn)}.cat.arc{color:var(--warn)}
.thumb{width:36px;height:36px;border-radius:5px;object-fit:cover;background:var(--canvas);border:1px solid var(--border);flex:0 0 36px}
tr.dotfile .name a{opacity:.72}
tr.symlink .link-mark{color:var(--muted);font-size:12px}
.broken{color:var(--muted);text-decoration:line-through}
.size,.when{color:var(--muted);text-align:right}
.when{font-family:var(--mono);font-size:13px}
.note{margin-top:14px;font-size:13px;color:var(--muted)}
.empty{padding:48px;text-align:center;color:var(--muted)}
.tree-empty{margin:12px 6px 0;color:var(--muted);font-size:13px}
.card{border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--surface)}
.card-head{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.card-head h1{margin:0;font:600 16px var(--mono)}
.card-head .meta{color:var(--muted);font-size:12.5px;font-family:var(--mono)}
.card-head .spacer{flex:1}
.download{border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:12.5px;color:var(--text)}
pre.code{margin:0;padding:12px 0 16px;overflow:auto;max-height:calc(100vh - 240px);font:13px/1.55 var(--mono);counter-reset:line;tab-size:4}
pre.code .line{display:block;padding:0 16px 0 0;white-space:pre;min-height:1.55em}
pre.code .line::before{counter-increment:line;content:counter(line);display:inline-block;width:64px;padding-right:16px;text-align:right;color:var(--muted);user-select:none}
.image-frame{display:flex;align-items:center;justify-content:center;padding:24px;min-height:240px;background-image:linear-gradient(45deg,var(--border) 25%,transparent 25%),linear-gradient(-45deg,var(--border) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,var(--border) 75%),linear-gradient(-45deg,transparent 75%,var(--border) 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}
.image-frame img{max-width:100%;max-height:70vh;border-radius:4px}
.placeholder{padding:56px 24px;text-align:center}
.placeholder .big{font-size:15px;margin:0 0 6px}
.placeholder .sub{color:var(--muted);font-size:13px;margin:0 0 18px}
.error-page{padding:64px 24px;text-align:center}
.error-code{font:700 64px/1 var(--mono);color:var(--danger)}
.error-page p{font-size:17px;margin:18px 0 6px}
.error-page .detail{color:var(--muted);font-size:13.5px}
footer.site{border-top:1px solid var(--border);color:var(--muted);font-size:12.5px;padding:14px 24px}
@media (max-width:720px){
  .bar{height:auto;min-height:56px;flex-wrap:wrap;padding:6px 16px;row-gap:2px}
  .brand{order:1}
  .badge{order:2;margin-left:auto}
  .git{order:3}
  .root{order:4}
  .shell{grid-template-columns:1fr}
  details.side-panel{position:static;max-height:none;overflow:visible;border-right:0;border-bottom:1px solid var(--border)}
  .side-summary{display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;list-style:none;font-family:var(--mono);font-size:13px;color:var(--muted)}
  .side-summary::-webkit-details-marker{display:none}
  .side-summary::before{content:"▸";color:var(--muted)}
  details.side-panel[open] .side-summary::before{content:"▾"}
  details.side-panel[open]>aside.side{max-height:45vh;overflow-y:auto;overscroll-behavior:contain}
  .when,.thumb{display:none}
}
@media (prefers-reduced-motion:no-preference){tbody tr{transition:background .08s ease}}`;

export interface Layout {
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
export function renderLayout(layout: Layout): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(layout.title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='6' fill='%2358a6ff'/%3E%3C/svg%3E">
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<noscript><style>.filter{display:none}.tw.toggle{visibility:hidden}</style></noscript>
${SPRITE}
<header class="site"><div class="bar">
  <span class="brand"><span class="dot"></span>serve</span>
  <span class="root">${escapeHtml(layout.rootLabel)}</span>
  ${renderGit(layout.git)}
  <span class="badge">read-only</span>
</div></header>
<div class="shell">
  <details class="side-panel" open>
    <summary class="side-summary">Files</summary>
    <aside class="side">
      <label class="filter">⌕ <input id="filter" type="search" placeholder="filter paths…" aria-label="Filter paths"></label>
      <nav class="tree" aria-label="File tree">${renderTree(layout.tree, layout.currentRel)}</nav>
      <p class="tree-empty" id="tree-empty" hidden>No matches.</p>
    </aside>
  </details>
  <main class="content" id="main" tabindex="-1">
    <nav class="crumbs" aria-label="Breadcrumb">${layout.breadcrumbs}</nav>
${layout.main}
  </main>
</div>
<footer class="site"><div class="wrap">served from ${escapeHtml(layout.rootLabel)} · read-only · ${layout.footerNote}</div></footer>
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
	return parts.join(`<span class="sep">/</span>`);
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
		? `<button type="button" class="tw toggle" aria-expanded="${expanded}" aria-label="${escapeHtml(node.name)}">${expanded ? "▾" : "▸"}</button>`
		: `<span class="tw spacer" aria-hidden="true"></span>`;
	const dataPath = ` data-path="${escapeHtml(node.rel)}"`;
	const name = isDir ? `${escapeHtml(node.name)}/` : escapeHtml(node.name);
	const children = expanded
		? `<ul>${node.children.map((child) => renderTreeNode(child, currentRel)).join("")}</ul>`
		: "";
	const label = node.broken
		? `<span class="broken" title="broken symbolic link">${name}</span><span class="link-mark">↩</span>`
		: `<a href="${href}">${name}</a>`;
	return `<li data-open="${expanded}"><div class="row"${current}${dataPath}>${twisty}${iconMarkup(spec)}${label}</div>${children}</li>`;
}

function renderRow(entry: DirEntry, maxThumbBytes: number, thumbnails: boolean): string {
	const spec = entry.isDir ? FOLDER_ICON : languageOf(entry.name);
	const showThumb = thumbnails && entry.isImage && !entry.broken && entry.size <= maxThumbBytes;
	const visual = showThumb
		? `<img class="thumb" alt="" loading="lazy" decoding="async" src="/raw/${encodePath(entry.rel)}">${iconMarkup(spec, true)}`
		: iconMarkup(spec);
	const name = entry.isDir ? `${escapeHtml(entry.name)}/` : escapeHtml(entry.name);
	const classes = [entry.name.startsWith(".") ? "dotfile" : "", entry.isSymlink ? "symlink" : ""]
		.filter(Boolean)
		.join(" ");
	const link = entry.broken
		? `<span class="broken" title="broken symbolic link">${name}</span>`
		: `<a href="${hrefFor(entry)}">${name}</a>`;
	const mark = entry.isSymlink
		? `<span class="link-mark" title="${entry.broken ? "broken symbolic link" : "symbolic link"}">↩</span>`
		: "";
	return `<tr${classes ? ` class="${classes}"` : ""} data-name="${escapeHtml(entry.name)}" data-path="${escapeHtml(entry.rel)}"><td><span class="name">${visual}${link}${mark}</span></td><td class="size">${entry.isDir ? "—" : escapeHtml(formatSize(entry.size))}</td><td class="when">${entry.isDir ? "—" : escapeHtml(formatDate(entry.mtimeMs))}</td></tr>`;
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
	let body = `<table class="listing">
<caption>${escapeHtml(page.rel || "/")}</caption>
<thead><tr><th scope="col">Name</th><th scope="col" class="size">Size</th><th scope="col" class="when">Modified</th></tr></thead>
<tbody>
${page.listing.entries.map((entry) => renderRow(entry, page.maxThumbBytes, page.thumbnails)).join("\n")}
</tbody>
</table>`;
	if (page.listing.entries.length === 0) body = `<div class="empty">This folder is empty.</div>`;
	else if (page.listing.truncated)
		body += `<p class="note">Showing the first ${page.listing.entries.length} of ${page.listing.total} entries.</p>`;

	return renderLayout({
		title: `serve · ${page.rel || "/"}`,
		rootLabel: page.rootLabel,
		tree: page.tree,
		currentRel: page.rel,
		breadcrumbs: renderBreadcrumbs(page.rel),
		main: `    ${body}`,
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
}

/** Render a file page (text, image, binary, or over-size). */
export function renderFilePage(page: FilePage): string {
	const name = page.rel.slice(page.rel.lastIndexOf("/") + 1);
	const spec = languageOf(name);
	const meta = `${spec.label} · ${formatSize(page.file.size)} · ${formatDate(page.file.mtimeMs)} · ${page.file.mime}`;
	const download = `<a class="download" href="/raw/${encodePath(page.rel)}" download>download</a>`;
	const head = `<div class="card-head">${iconMarkup(spec)}<h1>${escapeHtml(name)}</h1><span class="meta">${escapeHtml(meta)}</span><span class="spacer"></span>${download}</div>`;

	let content: string;
	let note = "";
	if (page.file.kind === "text") {
		const lines = page.file.lines
			.map((line) => `<span class="line">${line.length > 0 ? escapeHtml(line) : " "}</span>`)
			.join("");
		content = `<pre class="code"><code>${lines}</code></pre>`;
		if (page.file.truncated)
			note = `<p class="note">Showing the first ${page.file.lines.length} of ${page.file.totalLines} lines.</p>`;
	} else if (page.file.kind === "image") {
		content = `<div class="image-frame"><img src="/raw/${encodePath(page.rel)}" alt="${escapeHtml(name)}"></div>`;
	} else if (page.file.kind === "tooLarge") {
		content = `<div class="placeholder"><p class="big">File is ${escapeHtml(formatSize(page.file.size))}.</p><p class="sub">Larger than the ${escapeHtml(formatSize(page.maxFileBytes))} inline limit.</p>${download}</div>`;
	} else {
		content = `<div class="placeholder"><p class="big">Looks like a binary file.</p><p class="sub">${escapeHtml(formatSize(page.file.size))} · ${escapeHtml(page.file.mime)}</p>${download}</div>`;
	}

	return renderLayout({
		title: `serve · ${page.rel}`,
		rootLabel: page.rootLabel,
		tree: page.tree,
		currentRel: page.rel,
		breadcrumbs: renderBreadcrumbs(page.rel),
		main: `    <div class="card">${head}${content}</div>\n    ${note}`,
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
		title: `serve · ${page.status}`,
		rootLabel: page.rootLabel,
		tree: page.tree,
		currentRel: "",
		breadcrumbs: renderBreadcrumbs(""),
		main: `    <div class="error-page"><div class="error-code">${page.status}</div><p>${escapeHtml(page.message)}</p><p class="detail"><a href="/browse/">back to the served folder</a></p></div>`,
		footerNote: "error",
		git: page.git,
	});
}
