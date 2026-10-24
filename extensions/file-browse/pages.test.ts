/**
 * The pages capability: the page renderers, the Markdown and raw-HTML
 * renderers they compose, and the browser script served beside them.
 *
 * Assertions are about structure, escaping, width/overflow, and state, not about
 * a full page snapshot: the shared shell is pinned by `lib/web`, and the
 * browse-only rules are checked for the invariant that keeps a wide table or a
 * long line inside its pane.
 */

import { describe, expect, test } from "bun:test";
import {
	THEME_JS,
	WEB_BASE_CSS,
	WEB_COMPONENTS_CSS,
	WEB_LAYOUT_CSS,
	WEB_THEME_CSS,
	WEB_THEME_STORAGE_KEY,
} from "../../lib/web/index.ts";
import { localTimeMs } from "../../test/helpers/fixtures/file-browse.ts";
import { CLIENT_JS } from "./client.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { changeDirs, type ChangedFile } from "./diff.ts";
import { renderDiffLines } from "./diff-html.ts";
import type { DirEntry, FileView, Listing, TreeNode } from "./files.ts";
import {
	formatDate,
	renderBreadcrumbs,
	renderDiffPage,
	renderDirectoryPage,
	renderErrorPage,
	renderFileDiffPage,
	renderFilePage,
	type ChangeSummary,
	type DirectoryPage,
	type FilePage,
} from "./html.ts";
import { LIVE_CLIENT_JS } from "./live-client.ts";
import { renderMarkdown } from "./markdown.ts";
import { PALETTE_CLIENT_JS } from "./palette.ts";
import { BROWSE_CSS } from "./styles.ts";
import { TREE_CLIENT_JS } from "./tree.ts";
import {
	closesSuppressed,
	closeHtmlSink,
	createHtmlSink,
	htmlBlockStart,
	sanitizeHtmlBlock,
	sanitizeInlineTag,
} from "./raw-html.ts";
import { handleRequest } from "./router.ts";

const ROOT_LABEL = "/srv/aurora";
const MTIME_MS = 1_700_000_000_000;

const TREE: TreeNode = {
	name: "root",
	rel: "",
	isDir: true,
	isImage: false,
	broken: false,
	kind: "directory",
	children: [
		{
			name: "sub",
			rel: "sub",
			isDir: true,
			isImage: false,
			broken: false,
			kind: "directory",
			children: [
				{ name: "b.md", rel: "sub/b.md", isDir: false, isImage: false, broken: false, kind: "text", children: [] },
			],
		},
		{ name: 'a"<b>.txt', rel: 'a"<b>.txt', isDir: false, isImage: false, broken: false, kind: "text", children: [] },
	],
};

function entry(overrides: Partial<DirEntry> & Pick<DirEntry, "name" | "rel">): DirEntry {
	return {
		isDir: false,
		isSymlink: false,
		broken: false,
		size: 1,
		mtimeMs: MTIME_MS,
		kind: "text",
		isImage: false,
		...overrides,
	};
}

function listing(entries: DirEntry[], total = entries.length, truncated = false): Listing {
	return { entries, total, truncated };
}

function textView(lines: string[], overrides: Partial<Extract<FileView, { kind: "text" }>> = {}) {
	return {
		kind: "text" as const,
		lines,
		truncated: false,
		totalLines: lines.length,
		size: 12,
		mtimeMs: MTIME_MS,
		mime: "text/plain",
		...overrides,
	};
}

function markdownView(lines: string[], overrides: Partial<Extract<FileView, { kind: "markdown" }>> = {}) {
	return {
		kind: "markdown" as const,
		lines,
		truncated: false,
		totalLines: lines.length,
		size: 12,
		mtimeMs: MTIME_MS,
		mime: "application/octet-stream",
		...overrides,
	};
}

function directoryPage(overrides: Partial<DirectoryPage> = {}): string {
	return renderDirectoryPage({
		rootLabel: ROOT_LABEL,
		rel: "",
		listing: listing([]),
		tree: TREE,
		thumbnails: false,
		maxThumbBytes: 0,
		...overrides,
	});
}

function filePage(rel: string, file: FileView, overrides: Partial<FilePage> = {}): string {
	return renderFilePage({ rootLabel: ROOT_LABEL, rel, tree: TREE, maxFileBytes: 1_000_000, file, ...overrides });
}

const changed = (overrides: Partial<ChangedFile> = {}): ChangedFile => ({
	rel: "a.ts",
	index: " ",
	worktree: "M",
	untracked: false,
	...overrides,
});

function summary(files: ChangedFile[], insertions = 0, deletions = 0): ChangeSummary {
	return {
		count: files.length,
		insertions,
		deletions,
		files: new Set(files.map((file) => file.rel)),
		dirs: changeDirs(files),
	};
}

describe("page chrome", () => {
	test("renders the skip link, tree, filter, theme toggle, and keyboard sheet", () => {
		const html = directoryPage();
		expect(html).toContain('href="#main"');
		expect(html).toContain('id="main"');
		expect(html).toContain('id="copy-status"');
		expect(html).toContain('id="tree-empty"');
		expect(html).toContain('id="theme-toggle"');
		expect(html).toContain('src="/theme.js"');
		expect(html).toContain('id="keys-open"');
		expect(html).toContain('id="keys-dialog" hidden');
		expect(html).toContain('id="progress-fill"');
		expect(html).toContain('<details class="bf-app__sidebar browse-sidebar" open>');
		expect(html).toContain("<noscript>");
		expect(html).toContain('<span class="bf-tree__tw bf-tree__tw--spacer" aria-hidden="true"></span>');
		expect(html).toContain('aria-expanded="true"');
		expect(html).toContain("read-only");
	});

	test("ships each shared stylesheet block once", () => {
		// A repeated block is invisible in a rendered page — every rule still applies —
		// so only a count catches it, and only here: the kit does not know who concatenates it.
		for (const [name, block] of [
			["base", WEB_BASE_CSS],
			["theme", WEB_THEME_CSS],
			["layout", WEB_LAYOUT_CSS],
			["components", WEB_COMPONENTS_CSS],
		] as const) {
			expect(BROWSE_CSS.split(block).length - 1, `${name} block`).toBe(1);
		}
	});

	test("makes the tree one tab stop driven by the arrow keys", () => {
		const html = directoryPage();
		// The folder's own link carries the state, so a screen reader hears
		// "sub, folder, expanded" once; the twisty is a visual control only.
		expect(html).toMatch(/aria-expanded="(true|false)" title="/);
		expect(html).toContain('tabindex="-1" aria-hidden="true"');
		expect(html).not.toMatch(/bf-tree__tw--toggle"[^>]*aria-label=/);
		expect(TREE_CLIENT_JS).toContain('event.key === "ArrowRight"');
		expect(TREE_CLIENT_JS).toContain('event.key === "ArrowLeft"');
		expect(TREE_CLIENT_JS).toContain("function setTabStop(row)");
	});

	test("hands the quick-open palette to the page keymap", () => {
		expect(PALETTE_CLIENT_JS).toContain("window.bfPalette");
		expect(PALETTE_CLIENT_JS).toContain('getElementById("quick-open")');
		expect(CLIENT_JS).toContain("window.bfPalette.open()");
		expect(CLIENT_JS).toContain("window.bfPalette.isOpen()");
	});

	test("keeps a phone's card head to one row of controls", () => {
		// The download belongs to the action group so one narrow rule covers the file
		// and diff heads together. Below 520px the group holds one line and scrolls;
		// without the no-shrink rule, a control wraps its own label onto two lines.
		const html = filePage("sub/b.md", markdownView(["# hi"]));
		expect(html).toContain('title="Copy the root-relative path">copy path</button>');
		expect(html).toMatch(
			/copy path<\/button><a class="bf-btn" href="\/raw\/sub\/b\.md" download>download<\/a><\/span>/,
		);
		expect(BROWSE_CSS).toContain(".bf-card__actions{max-width:100%;flex-wrap:nowrap;overflow-x:auto}");
		expect(BROWSE_CSS).toContain(".bf-card__actions>*{flex:0 0 auto}");
	});

	test("keeps the served folder's tail when the header path is cut", () => {
		// A left ellipsis names the root; cutting the end kept only
		// `Users/gavin/Repositories/Github/` and lost the folder being browsed.
		expect(BROWSE_CSS).toContain(".browse-root{flex:1 1 auto;direction:rtl;text-align:left}");
		expect(BROWSE_CSS).toContain("@media (max-width:820px){\n.browse-root{order:9;flex:1 1 100%}");
		expect(BROWSE_CSS).not.toContain("direction:ltr");
	});

	test("drops a phone's trailing table column so the name keeps the room", () => {
		// The listing's Modified and the diff's Changes are the widest fixed columns
		// and the least of what a reader is choosing between: at 390px the name had
		// 106px of 342 and every entry truncated. The diff keeps its change letter on
		// the badge, which carries the same label.
		expect(BROWSE_CSS).toContain(".browse-listing .bf-table__when,.browse-diff .browse-diff-word{display:none}");
		const rows = [entry({ name: "CHANGELOG.md", rel: "CHANGELOG.md" })];
		expect(directoryPage({ listing: listing(rows) })).toContain('<th scope="col" class="bf-table__when">');
		const diff = renderDiffPage({
			rootLabel: ROOT_LABEL,
			mode: "head",
			files: [changed({ rel: "src/config.ts" })],
			stat: " src/config.ts | 2 +-",
			tree: TREE,
		});
		expect(diff).toContain('<th scope="col" class="browse-diff-word">');
	});

	test("spans the card with every table instead of leaving a ragged band", () => {
		// A shrink-wrapped table stops at its own content, which leaves card beside it —
		// 254px at 2560px wide, 300px beside the three-column tables at 1440 — and a
		// reader cannot tell that from a column that failed to draw. Below the floor's
		// threshold the table's min-content wins, so it still scrolls.
		const prose = filePage("sub/b.md", markdownView(["# hi"]));
		expect(prose).toContain(".browse-measure .bf-md .md-table-frame table{width:100%;max-width:var(--browse-measure)}");
	});

	test("prints the page without its clipping", () => {
		// The base layer drops the chrome; a browse page is also a card with an
		// inner scroller and a pinned hunk header, and neither belongs on paper.
		expect(BROWSE_CSS).toContain("@media print{");
		expect(BROWSE_CSS).toContain("overflow:visible!important}");
		expect(BROWSE_CSS).toContain(".bf-diff .bf-diff-line--hunk{position:static}");
	});

	test("keeps the listing and the Markdown column inside their panes", () => {
		const listingHtml = directoryPage();
		expect(listingHtml).toContain("table-layout:fixed");
		expect(listingHtml).toContain("@media not (max-width:860px){");
		expect(listingHtml).toContain(".browse-sidebar{position:relative;overflow:hidden}");
		expect(listingHtml).toContain(".browse-side .bf-tree{flex:1 1 auto;min-height:0;overflow:auto}");
		expect(listingHtml).not.toMatch(/max-width:1[24]00px/);

		const prose = filePage("sub/b.md", markdownView(["# hi"]));
		expect(prose).toContain('class="bf-app__main browse-page browse-measure"');
		expect(prose).toContain("--browse-measure");
		expect(prose).toMatch(/\.browse-measure \.bf-md>\*\{max-width:var\(--browse-measure\)/);
		expect(prose).toContain(".md-table-frame.browse-table-more::after{");
	});

	test("floors a table's cells so a narrow pane scrolls instead of stacking", () => {
		// Auto layout starves the prose column against a nowrapped code span, and a
		// cell of one word per line turns a ten-row table into a 2000px strip. The
		// floor only applies to a pane narrower than 600px, so a table that still
		// fits keeps sizing its columns to the content.
		const prose = filePage("sub/b.md", markdownView(["# hi"]));
		expect(prose).toContain(".browse-measure .bf-md>.md-table-frame{max-width:none;");
		expect(prose).toContain("container-type:inline-size");
		expect(prose).toContain("@container (max-width:600px){");
		expect(prose).toContain(".browse-measure .bf-md .md-table-frame td{min-width:14em}");
	});

	test("renders the git chip with the branch alone", () => {
		const html = directoryPage({ git: { branch: "main" } });
		expect(html).toContain('class="bf-chip browse-git"');
		expect(html).toContain('aria-label="git branch main"');
		expect(html).not.toContain("browse-dirty");
	});

	test("omits the git chip without a status", () => {
		expect(directoryPage()).not.toContain('class="bf-chip browse-git');
	});

	test("renders the live chrome only when the channel is on", () => {
		const live = directoryPage({ live: { intervalMs: 3000 } });
		expect(live).toContain('id="live-state"');
		expect(live).toContain('data-interval="3000"');
		expect(live).toContain('class="browse-live-line" id="live-status" hidden');
		expect(live).toContain('id="browse-changes" href="/diff"');

		const off = directoryPage();
		expect(off).not.toContain("live-state");
		expect(off).not.toContain("live-status");
		expect(off).toContain('<footer class="bf-app__footer">served from ');
	});
});

describe("directory page", () => {
	test("escapes names, marks the current node, and adds thumbnails", () => {
		const html = directoryPage({
			rel: "sub",
			listing: listing([
				entry({ name: "sub", rel: "sub", isDir: true, kind: "directory" }),
				entry({ name: "image.png", rel: "image.png", isImage: true, kind: "image", size: 100 }),
				entry({ name: 'a"<b>.txt', rel: 'a"<b>.txt', size: 5 }),
			]),
			thumbnails: true,
			maxThumbBytes: 5_000_000,
		});
		expect(html).toContain('aria-current="page"');
		expect(html).toContain('<img class="bf-table__thumb"');
		expect(html).toContain("&lt;b&gt;");
		expect(html).not.toContain(`a"<b>`);
	});

	test("reports truncation and empty folders", () => {
		expect(directoryPage()).toContain("This folder is empty.");
		const truncated = directoryPage({
			listing: listing([entry({ name: "one", rel: "one" })], 5, true),
		});
		expect(truncated).toContain("first 1 of 5");
	});

	test("names the root listing after the served folder", () => {
		const html = directoryPage({ rootLabel: "/srv/aurora" });
		expect(html).toContain('id="page-title">aurora</h1>');
		expect(html).not.toContain('id="page-title">/</h1>');
	});

	test("marks rows with sort keys and headers as sortable", () => {
		const html = directoryPage({
			listing: listing([
				entry({ name: "sub", rel: "sub", isDir: true, kind: "directory", size: 0 }),
				entry({ name: "a.txt", rel: "a.txt", size: 12 }),
			]),
		});
		expect(html).toContain('data-sort="name"');
		expect(html).toContain('data-sort="size"');
		expect(html).toContain('data-sort="mtime"');
		expect(html).toContain('aria-sort="ascending"');
		expect(html).toContain('data-dir="1"');
		expect(html).toContain('data-dir="0"');
		expect(html).toContain('data-size="12"');
		expect(html).toContain(`data-mtime="${MTIME_MS}"`);
	});

	test("renders a broken symlink as a non-link", () => {
		const html = directoryPage({
			listing: listing([
				entry({ name: "dangling", rel: "dangling", isSymlink: true, broken: true, kind: "binary", size: 0 }),
			]),
		});
		expect(html).toContain('class="browse-broken" title="broken symbolic link"');
		expect(html).not.toContain('href="/view/dangling"');
	});

	test("publishes the fold-all control and the quick-open trigger", () => {
		const html = directoryPage();
		expect(html).toContain('id="fold-all"');
		expect(html).toContain('title="Fold or expand every folder"');
		expect(html).toContain("<dd>Fold or expand every folder</dd>");
		expect(html).toContain('id="quick-open"');
		expect(html).toContain('aria-haspopup="dialog"');
	});

	test("shows the changes chip with its totals, or a hidden shell when live", () => {
		const two = directoryPage({ summary: summary([changed({ rel: "a.ts" }), changed({ rel: "b.ts" })], 12, 4) });
		expect(two).toContain('class="bf-chip browse-diff" id="browse-changes" href="/diff"');
		expect(two).toContain("2 changes");
		expect(two).toContain("+12");
		expect(two).toContain("−4");

		expect(directoryPage({ summary: summary([changed({ rel: "a.ts" })]) })).toContain("1 change");
		expect(directoryPage({ summary: summary([]) })).not.toContain('class="bf-chip browse-diff"');
		expect(directoryPage()).not.toContain('class="bf-chip browse-diff"');

		const shell = directoryPage({ live: { intervalMs: 3000 } });
		expect(shell).toContain('title="View uncommitted changes" hidden');
		expect(directoryPage({ live: { intervalMs: 3000 }, summary: summary([changed()]) })).not.toContain(
			'title="View uncommitted changes" hidden',
		);
	});

	test("marks changed files and their directories in the listing and tree", () => {
		const html = directoryPage({
			listing: listing([
				entry({ name: "sub", rel: "sub", isDir: true, kind: "directory", size: 0 }),
				entry({ name: "a.txt", rel: "a.txt", size: 12 }),
			]),
			summary: summary([changed({ rel: "sub/b.md" }), changed({ rel: "a.txt" })]),
		});
		expect(html).toContain('class="browse-change"');
		expect(html).toContain('title="uncommitted changes"');
		expect((html.match(/class="browse-change"/g) ?? []).length).toBeGreaterThanOrEqual(3);
	});
});

describe("file page", () => {
	test("renders text lines with line numbers and a download link", () => {
		const html = filePage("a.txt", textView(["hello", ""]));
		expect(html).toContain('<span class="bf-code__line">hello</span>');
		expect(html).toContain('href="/raw/a.txt"');
		expect(html).toContain("download");
	});

	test("highlights a code file but leaves plain text alone", () => {
		const file = textView(["const x = 1;"]);
		expect(filePage("a.js", file)).toContain('<span class="tok-keyword">const</span>');
		expect(filePage("a.txt", file)).toContain('<span class="bf-code__line">const x = 1;</span>');
	});

	test("renders a Markdown page with a raw toggle and copy actions", () => {
		const html = filePage("sub/b.md", markdownView(["# hi", "", "some **bold** text"]));
		expect(html).toContain('<article class="bf-md">');
		expect(html).toContain('<h2 id="hi">hi</h2>');
		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain('href="/view/sub/b.md?raw=1"');
		expect(html).toContain('data-copy="content"');
		expect(html).toContain('data-value="sub/b.md"');
		expect(html).not.toContain('id="wrap-toggle"');
		expect(html).toContain("Toggle rendered and raw");
	});

	test("renders raw Markdown with a wrap toggle and a rendered link", () => {
		const html = filePage("sub/b.md", markdownView(["# hi"]), { markdownRaw: true });
		expect(html).toContain('<pre class="bf-code bf-code--numbered" data-path="sub/b.md">');
		expect(html).toContain('id="wrap-toggle"');
		expect(html).toContain('href="/view/sub/b.md"');
		expect(html).not.toContain('class="bf-md"');
	});

	test("offers a code reference where lines are numbered", () => {
		// The button and the key both need the file's path and its line spans, which is
		// why the numbered pre names the file and the sheet lists `y`.
		const text = filePage("a.txt", textView(["hello", "world"]));
		expect(text).toContain('data-path="a.txt"');
		expect(text).toContain('id="copy-reference"');
		expect(text).toContain("Copy a reference to the selected lines");

		const raw = filePage("sub/b.md", markdownView(["# hi"]), { markdownRaw: true });
		expect(raw).toContain('id="copy-reference"');
	});

	test("offers no reference where no line is numbered", () => {
		const rendered = filePage("sub/b.md", markdownView(["# hi", "text"]));
		expect(rendered).not.toContain('id="copy-reference"');
		expect(rendered).not.toContain("Copy a reference");
		// The tree rows carry data-path too, so the absence to assert is the numbered pre.
		expect(rendered).not.toContain('<pre class="bf-code bf-code--numbered"');

		const image = filePage("image.png", { kind: "image", size: 68, mtimeMs: MTIME_MS, mime: "image/png" });
		expect(image).not.toContain('id="copy-reference"');
	});

	test("ships the reference copy as one client function set", () => {
		// The range is read from the DOM's own line spans, so the client source is the
		// only place the mapping exists; a broken selector would copy nothing.
		expect(CLIENT_JS).toContain("function captureReference()");
		expect(CLIENT_JS).toContain("function copyReference()");
		expect(CLIENT_JS).toContain('from.closest("pre[data-path]")');
		expect(CLIENT_JS).toContain('event.key === "y"');
		expect(CLIENT_JS).toContain("Select lines in the code to copy a reference.");
	});

	test("renders an image through the raw route", () => {
		const html = filePage("image.png", { kind: "image", size: 68, mtimeMs: MTIME_MS, mime: "image/png" });
		expect(html).toContain('<img src="/raw/image.png"');
	});

	test("renders the too-large and binary states without a code block", () => {
		const tooLarge = filePage(
			"big.bin",
			{ kind: "tooLarge", size: 9_000_000, mtimeMs: MTIME_MS, mime: "" },
			{
				maxFileBytes: 4096,
			},
		);
		expect(tooLarge).toContain("Larger than the 4.0 kB inline limit.");
		expect(tooLarge).toContain('href="/raw/big.bin"');
		expect(tooLarge).not.toContain('<pre class="bf-code');

		const binary = filePage("bin.dat", {
			kind: "binary",
			size: 6,
			mtimeMs: MTIME_MS,
			mime: "application/octet-stream",
		});
		expect(binary).toContain("Looks like a binary file.");
		expect(binary).toContain("6 B · application/octet-stream");
		expect(binary).toContain('href="/raw/bin.dat"');
	});

	test("renders a changes action only for a changed file", () => {
		const html = filePage("a.txt", textView(["x"]), { changed: true });
		expect(html).toContain('href="/diff/a.txt"');
		expect(filePage("a.txt", textView(["x"]))).not.toContain('href="/diff/a.txt"');
	});

	test("drops the octet-stream metadata and escapes the footer path", () => {
		const html = filePage("a<b>.txt", textView(["x"]));
		expect(html).toContain("Text ·");
		expect(html).not.toContain("application/octet-stream");
		expect(html).toContain("read-only · a&lt;b&gt;.txt</footer>");
	});
});

describe("error page", () => {
	test("renders the status, the reason, and a way back", () => {
		const html = renderErrorPage({
			rootLabel: ROOT_LABEL,
			status: 404,
			message: "That page does not exist.",
			tree: TREE,
		});
		expect(html).toContain("browse · 404");
		expect(html).toContain('<div class="bf-empty__code">404</div>');
		expect(html).toContain("That page does not exist.");
		expect(html).toContain('<a href="/browse/">back to the served folder</a>');
	});

	test("escapes the message instead of rendering it", () => {
		const html = renderErrorPage({
			rootLabel: ROOT_LABEL,
			status: 400,
			message: '<script>alert("x")</script>',
			tree: TREE,
		});
		expect(html).not.toContain("<script>alert");
		expect(html).toContain("&lt;script&gt;");
	});
});

describe("breadcrumbs", () => {
	test("renders ancestor segments as links and stops before the current page", () => {
		const html = renderBreadcrumbs("sub/extensions");
		expect(html).toContain('<a href="/browse/sub">sub</a>');
		expect(html).not.toContain("extensions</span>");
	});

	test("marks home current at the root", () => {
		expect(renderBreadcrumbs("")).toContain(`aria-current="page">home</span>`);
	});
});

describe("dates", () => {
	test("formats a local timestamp and a non-date", () => {
		expect(formatDate(localTimeMs(2026, 9, 8, 20, 31))).toBe("Oct 8 20:31");
		expect(formatDate(Number.NaN)).toBe("—");
	});
});

describe("diff pages", () => {
	test("lists changed files with status, mode links, and the stat", () => {
		const rows = [
			changed({ rel: "a.ts", index: "M", worktree: " " }),
			changed({ rel: "new.txt", untracked: true, index: "?", worktree: "?" }),
			changed({ rel: "x/y.md", origRel: "y/x.md", index: "R", worktree: " " }),
		];
		const html = renderDiffPage({
			rootLabel: ROOT_LABEL,
			mode: "head",
			files: rows,
			stat: " a.ts | 2 +-\n 1 file changed",
			tree: TREE,
			summary: summary(rows, 12, 4),
		});
		expect(html).toContain('aria-current="page">head</a>');
		expect(html).toContain('href="/diff?mode=staged"');
		expect(html).toContain('href="/diff?mode=worktree"');
		expect(html).toContain('href="/diff/a.ts"');
		expect(html).toContain('href="/diff/new.txt"');
		expect(html).toContain('aria-label="modified">M</span>');
		expect(html).toContain('aria-label="untracked">?</span>');
		expect(html).toContain("from y/x.md");
		expect(html).toContain("1 file changed");
	});

	test("shows an empty state when nothing changed", () => {
		const html = renderDiffPage({ rootLabel: ROOT_LABEL, mode: "staged", files: [], stat: "", tree: TREE });
		expect(html).toContain("No changes staged vs HEAD.");
		expect(html).toContain('aria-current="page">staged</a>');
	});

	test("escapes paths and stat text", () => {
		const html = renderDiffPage({
			rootLabel: ROOT_LABEL,
			mode: "head",
			files: [changed({ rel: 'a"<b>.ts' })],
			stat: "<script>alert(1)</script>",
			tree: TREE,
		});
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).toContain("a&quot;&lt;b&gt;.ts");
	});

	test("renders diff lines with a gutter, a sign, and a kind class", () => {
		const html = renderDiffLines([
			{ kind: "meta", text: "diff --git a/a b/a" },
			{ kind: "hunk", text: "@@ -1 +1 @@" },
			{ kind: "ctx", text: "keep", oldNo: 1, newNo: 1 },
			{ kind: "del", text: "old", oldNo: 2 },
			{ kind: "add", text: "new", newNo: 2 },
			{ kind: "note", text: "\\ No newline at end of file" },
		]);
		expect(html).toContain("bf-diff-line--hunk");
		expect(html).toContain("bf-diff-line--add");
		expect(html).toContain("bf-diff-line--del");
		expect(html).toContain("bf-diff-line--note");
		expect(html).toContain('<span class="browse-diff-no" aria-hidden="true">2</span>');
		expect(html).toContain('class="browse-diff-sign" aria-hidden="true">+</span>');
		expect(html).toContain('class="browse-diff-sign" aria-hidden="true">-</span>');
	});

	test("wraps each hunk and its body in a bounded section", () => {
		const html = renderDiffLines([
			{ kind: "meta", text: "diff --git a/a b/a" },
			{ kind: "hunk", text: "@@ -1 +1 @@" },
			{ kind: "ctx", text: "keep", oldNo: 1, newNo: 1 },
			{ kind: "hunk", text: "@@ -9 +9 @@" },
			{ kind: "add", text: "new", newNo: 9 },
		]);
		expect(html).toContain('<span class="bf-diff-hunk" id="hunk-1" data-hunk="1">');
		expect(html).toContain('<span class="bf-diff-hunk" id="hunk-2" data-hunk="2">');
		expect((html.match(/class="bf-diff-hunk"/g) ?? []).length).toBe(2);
		expect(html).toStartWith('<span class="bf-code__line bf-diff-line bf-diff-line--meta"');
		expect(html).toEndWith("</span></span>");
	});

	test("escapes diff content and highlights a hunk's context lines", () => {
		const escaped = renderDiffLines([{ kind: "add", text: "<img src=x onerror=alert(1)>", newNo: 1 }]);
		expect(escaped).not.toContain("<img");
		expect(escaped).toContain("&lt;img");

		const highlighted = renderDiffLines(
			[
				{ kind: "hunk", text: "@@ -1,3 +1,3 @@" },
				{ kind: "ctx", text: "const keep = 1;", oldNo: 1, newNo: 1 },
				{ kind: "del", text: "const old = 2;", oldNo: 2 },
				{ kind: "add", text: "const next = 2;", newNo: 2 },
				{ kind: "ctx", text: "const after = 3;", oldNo: 3, newNo: 3 },
			],
			"ts",
		);
		expect(highlighted.match(/tok-keyword/g)?.length).toBe(4);
		expect(highlighted).toContain("keep = ");
		expect(highlighted).toContain("after = ");
		expect((highlighted.match(/bf-diff-line--ctx/g) ?? []).length).toBe(2);
		expect((highlighted.match(/bf-diff-line--add/g) ?? []).length).toBe(1);
		expect((highlighted.match(/bf-diff-line--del/g) ?? []).length).toBe(1);
	});

	test("renders a per-file diff with mode links that keep the path", () => {
		const html = renderFileDiffPage({
			rootLabel: ROOT_LABEL,
			rel: "sub/b.md",
			mode: "staged",
			tree: TREE,
			diff: {
				mode: "staged",
				rel: "sub/b.md",
				lines: [
					{ kind: "hunk", text: "@@ -1 +1 @@" },
					{ kind: "del", text: "old", oldNo: 1 },
					{ kind: "add", text: "new", newNo: 1 },
				],
				binary: false,
				truncated: false,
			},
		});
		expect(html).toContain('href="/diff/sub/b.md?mode=staged" aria-current="page">staged</a>');
		expect(html).toContain('href="/diff/sub/b.md"');
		expect(html).toContain('aria-label="Diff mode"');
		expect(html).toContain("bf-diff-line--add");
		expect(html).toContain('href="/view/sub/b.md"');
		expect(html).toContain('id="wrap-toggle"');
	});

	test("notes truncation and reports binary and empty diffs", () => {
		const base = { rootLabel: ROOT_LABEL, rel: "a.ts", mode: "head" as const, tree: TREE };
		const truncated = renderFileDiffPage({
			...base,
			diff: {
				mode: "head",
				rel: "a.ts",
				lines: [{ kind: "add", text: "x", newNo: 1 }],
				binary: false,
				truncated: true,
			},
		});
		expect(truncated).toContain("Showing the first 1 diff lines.");

		const binary = renderFileDiffPage({
			...base,
			diff: { mode: "head", rel: "a.ts", lines: [], binary: true, truncated: false },
		});
		expect(binary).toContain("Binary or unreadable change.");

		const empty = renderFileDiffPage({
			...base,
			diff: { mode: "head", rel: "a.ts", lines: [], binary: false, truncated: false },
		});
		expect(empty).toContain("No changes for this file.");
	});

	test("summarises a file diff and anchors each hunk", () => {
		const html = renderFileDiffPage({
			rootLabel: ROOT_LABEL,
			rel: "a.ts",
			mode: "head",
			tree: TREE,
			diff: {
				mode: "head",
				rel: "a.ts",
				lines: [
					{ kind: "hunk", text: "@@ -1 +1 @@" },
					{ kind: "del", text: "old", oldNo: 1 },
					{ kind: "add", text: "new", newNo: 1 },
					{ kind: "add", text: "more", newNo: 2 },
				],
				binary: false,
				truncated: false,
			},
		});
		expect(html).toContain("browse-diff-summary");
		expect(html).toContain("+2");
		expect(html).toContain("−1");
		expect(html).toContain("1 hunk");
		expect(html).toContain("Next and previous change");
		expect(html).toContain('data-hunk="1"');
	});
});

describe("Markdown blocks", () => {
	test("demotes headings, keeps their text, and suffixes repeated slugs", () => {
		expect(renderMarkdown("# Title")).toContain('<h2 id="title">Title</h2>');
		expect(renderMarkdown("### Three ###")).toContain('<h4 id="three">Three</h4>');
		expect(renderMarkdown("# C#")).toContain('<h2 id="c">C#</h2>');
		expect(renderMarkdown("# Hello, World!")).toContain('<h2 id="hello-world">Hello, World!</h2>');

		const repeated = renderMarkdown("# Setup\n\n## Setup");
		expect(repeated).toContain('<h2 id="setup">Setup</h2>');
		expect(repeated).toContain('<h3 id="setup-1">Setup</h3>');
	});

	test("renders paragraphs and hard breaks", () => {
		expect(renderMarkdown("one\ntwo")).toContain("<p>one\ntwo</p>");
		expect(renderMarkdown("one  \ntwo")).toContain("one<br>");
		expect(renderMarkdown("one\\\ntwo")).toContain("one<br>");
	});

	test("highlights fenced code with a known language and escapes the body", () => {
		const html = renderMarkdown("```js\nconst x = 1 < 2;\n```");
		expect(html).toContain('<pre class="md-code"><code class="language-js">');
		expect(html).toContain('<span class="tok-keyword">const</span>');
		expect(html).toContain("&lt;");
		expect(renderMarkdown("```\nplain\n```")).toContain('<pre class="md-code"><code>plain</code></pre>');
	});

	test("leaves an unknown fence language unhighlighted", () => {
		const html = renderMarkdown("```mystery\nconst x = 1;\n```");
		expect(html).toContain('class="language-mystery"');
		expect(html).not.toContain("tok-keyword");
	});

	test("resolves a long-form fence language and carries state across its lines", () => {
		const html = renderMarkdown("```typescript\n/* note\ndone */\nconst x = 1;\n```");
		expect(html).toContain('<span class="tok-comment">/* note</span>');
		expect(html).toContain('<span class="tok-comment">done */</span>');
		expect(html).toContain('<span class="tok-keyword">const</span>');
	});

	test("escapes a highlighted fence body so it cannot inject markup", () => {
		const html = renderMarkdown('```js\nconst a = "</span><img src=x>";\n```');
		expect(html).toContain("&lt;/span&gt;&lt;img");
		expect(html).not.toContain("<img");
	});

	test("renders thematic breaks and blockquotes", () => {
		expect(renderMarkdown("---")).toContain("<hr>");
		expect(renderMarkdown("* * *")).toContain("<hr>");
		expect(renderMarkdown("> quoted")).toContain("<blockquote><p>quoted</p></blockquote>");
		expect(renderMarkdown("> one\n>\n> two")).toContain("<blockquote><p>one</p>\n<p>two</p></blockquote>");
	});

	test("renders unordered, ordered, nested, and task lists", () => {
		expect(renderMarkdown("- a\n- b")).toContain("<ul><li>a</li><li>b</li></ul>");
		expect(renderMarkdown("1. a\n2. b")).toContain("<ol><li>a</li><li>b</li></ol>");

		const nested = renderMarkdown("- a\n  - b\n- c");
		expect(nested).toContain("<ul><li>a\n<ul><li>b</li></ul></li>");
		expect(nested).toContain("<li>c</li>");

		const tasks = renderMarkdown("- [x] done\n- [ ] todo");
		expect(tasks).toContain('<li class="task done">');
		expect(tasks).toContain('<input class="md-check" type="checkbox" disabled checked> done');
		expect(tasks).toContain('<li class="task">');
		expect(tasks).toContain('<input class="md-check" type="checkbox" disabled> todo');
	});

	test("renders tables with alignment, a scroll wrapper, and column scopes", () => {
		const html = renderMarkdown("| a | b |\n| :--- | ---: |\n| 1 | 2 |");
		expect(html).toContain('<div class="md-table-frame"><div class="md-table-wrap"><table class="md-table">');
		expect(html).toContain('<th scope="col" class="md-left">a</th>');
		expect(html).toContain('<th scope="col" class="md-right">b</th>');
		expect(html).toContain('<td class="md-left">1</td>');
		expect(html).toContain('<td class="md-right">2</td>');
	});

	test("treats a bad delimiter row as a paragraph and a pipe list item as a list", () => {
		expect(renderMarkdown("| a | b |\nnot a table")).not.toContain("<table");
		expect(renderMarkdown("| a | b |\n| --- |\n| 1 | 2 |")).not.toContain("<table");

		const piped = renderMarkdown("- | a | b |\n  | --- | --- |\n  | 1 | 2 |");
		expect(piped).toContain("<ul><li>");
		expect(piped).toContain('<table class="md-table">');
		expect(piped).not.toContain('<th scope="col">-</th>');
	});
});

describe("Markdown inline", () => {
	test("renders code spans, emphasis, and strikethrough", () => {
		expect(renderMarkdown("`a < b`")).toContain("<code>a &lt; b</code>");
		const html = renderMarkdown("**bold** *italic* ~~gone~~");
		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain("<em>italic</em>");
		expect(html).toContain("<del>gone</del>");
	});

	test("does not emphasize intraword underscores", () => {
		expect(renderMarkdown("foo_bar_baz")).toContain("foo_bar_baz");
		expect(renderMarkdown("foo_bar_baz")).not.toContain("<em>");
	});

	test("renders safe links and rewrites local ones", () => {
		expect(renderMarkdown("[x](https://example.com)")).toContain(
			'<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>',
		);
		expect(renderMarkdown("[x](mailto:a@b.c)")).toContain('<a href="mailto:a@b.c">x</a>');
		expect(renderMarkdown("[x](a.md)")).toContain('<a href="/view/a.md">x</a>');
		expect(renderMarkdown("[x](#anchor)")).toContain('<a href="#anchor">x</a>');
		expect(renderMarkdown('[x](a.md "title")')).toContain('<a href="/view/a.md" title="title">x</a>');
	});

	test("resolves reference links, shortcut references, and reference images", () => {
		const html = renderMarkdown('See [pi][p] and [docs][].\n\n[p]: https://pi.dev\n[docs]: /guide "Guide"');
		expect(html).toContain('<a href="https://pi.dev" target="_blank" rel="noopener noreferrer">pi</a>');
		expect(html).toContain('<a href="/view/guide" title="Guide">docs</a>');
		expect(html).not.toContain("[p]:");
		expect(html).not.toContain("[docs]:");

		expect(renderMarkdown("see [Pi Store]\n\n[pi   store]: https://pi.dev")).toContain(
			'<a href="https://pi.dev" target="_blank" rel="noopener noreferrer">Pi Store</a>',
		);
		expect(renderMarkdown("![logo][l]\n\n[l]: img/a.png")).toContain(
			'<img class="md-img" src="/raw/img/a.png" alt="logo"',
		);
	});

	test("leaves an unresolved reference as text and does not read one out of a fence", () => {
		expect(renderMarkdown("[x][nope]")).toContain("[x][nope]");
		const fenced = renderMarkdown("```\n[p]: https://pi.dev\n```");
		expect(fenced).toContain("[p]: https://pi.dev");
		expect(fenced).not.toContain("<a href");
	});

	test("drops unsafe link schemes to plain text", () => {
		const script = renderMarkdown("[x](javascript:alert(1))");
		expect(script).toContain(">x<");
		expect(script).not.toContain("href");
		const data = renderMarkdown("[x](data:text/html,<script>)");
		expect(data).not.toContain("href");
	});

	test("renders angle and bare autolinks, but not a bare scheme or a code span", () => {
		expect(renderMarkdown("<https://example.com>")).toContain(
			'<a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a>',
		);

		const link = (href: string, label: string) =>
			`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
		expect(renderMarkdown("see https://discord.com/invite/abc now")).toContain(
			link("https://discord.com/invite/abc", "https://discord.com/invite/abc"),
		);
		expect(renderMarkdown("www.example.com/path")).toContain(
			link("http://www.example.com/path", "www.example.com/path"),
		);
		expect(renderMarkdown("(see https://example.com/a).")).toContain(
			link("https://example.com/a", "https://example.com/a"),
		);
		expect(renderMarkdown("https://localhost:8080")).not.toContain("<a ");
		expect(renderMarkdown("xhttps://example.com")).not.toContain("<a ");
		expect(renderMarkdown("`https://example.com`")).toContain("<code>https://example.com</code>");
	});

	test("resolves relative links and images, and drops an escaping image", () => {
		expect(renderMarkdown("[x](other.md)", "docs/sub")).toContain('<a href="/view/docs/sub/other.md">x</a>');
		expect(renderMarkdown("![i](i.png)", "docs")).toContain('<img class="md-img" src="/raw/docs/i.png"');
		expect(renderMarkdown("![i](</img/a b.png>)", "docs")).toContain('src="/raw/img/a%20b.png"');
		expect(renderMarkdown("![i](../../secret.png)", "docs")).not.toContain("<img");
		expect(renderMarkdown("![i](../secret.png)")).not.toContain("<img");
	});

	test("renders an external image as a link", () => {
		expect(renderMarkdown("![i](https://example.com/i.png)")).toContain(
			'<a href="https://example.com/i.png" target="_blank" rel="noopener noreferrer">i</a>',
		);
	});
});

describe("Markdown character references", () => {
	test("decodes numeric and named references as literal text", () => {
		expect(renderMarkdown("AT&amp;T and &copy;")).toContain("AT&amp;T and ©");
		expect(renderMarkdown("&#65;&#x42; &#x1F600;")).toContain("AB 😀");
	});

	test("does not let a reference become markup", () => {
		const html = renderMarkdown("&#42;x&#42; and &#35; heading");
		expect(html).toContain("*x* and # heading");
		expect(html).not.toContain("<em>");
	});

	test("keeps an unknown or invalid reference literal", () => {
		expect(renderMarkdown("&foo;")).toContain("&amp;foo;");
		expect(renderMarkdown("&toString; &constructor;")).toContain("&amp;toString; &amp;constructor;");
		expect(renderMarkdown("&#xD800; &#1114112;")).toContain("\uFFFD \uFFFD");
	});

	test("leaves a reference in a code span undecoded", () => {
		expect(renderMarkdown("`&amp;`")).toContain("<code>&amp;amp;</code>");
	});
});

describe("Markdown raw HTML", () => {
	test("renders an HTML block and balances it", () => {
		const html = renderMarkdown("<details>\n<summary>Show</summary>\n\nInside **bold**.\n\n</details>");
		expect(html).toContain("<details>");
		expect(html).toContain("<summary>Show</summary>");
		expect(html).toContain("<p>Inside <strong>bold</strong>.</p>");
		expect(html).toContain("</details>");
		expect(renderMarkdown("<div>\nunclosed")).toContain("unclosed</div>");
	});

	test("does not parse Markdown inside an HTML block", () => {
		const html = renderMarkdown("<div>\n**x**\n</div>");
		expect(html).toContain("**x**");
		expect(html).not.toContain("<strong>");
	});

	test("accepts phrasing HTML in a paragraph and escapes a block tag there", () => {
		expect(renderMarkdown("press <kbd>Ctrl</kbd> + <kbd>C</kbd>")).toContain("press <kbd>Ctrl</kbd> + <kbd>C</kbd>");
		expect(renderMarkdown("x <b>bold</b> y")).toContain("x <b>bold</b> y");
		expect(renderMarkdown("text <div>x</div>")).toContain("text &lt;div&gt;x&lt;/div&gt;");
	});

	test("closes an unclosed inline tag at the end of its line", () => {
		expect(renderMarkdown("<b>bold")).toContain("<b>bold</b>");
	});

	test("keeps a raw heading and leaves a definition inside an HTML block literal", () => {
		const html = renderMarkdown("<h2>Raw</h2>\n\n# Markdown");
		expect(html).toContain("<h2>Raw</h2>");
		expect(html).toContain('<h2 id="markdown">Markdown</h2>');

		const definition = renderMarkdown("<pre>\n[p]: https://pi.dev\n</pre>\n\n[p]");
		expect(definition).toContain("[p]: https://pi.dev");
		expect(definition).not.toContain("<a href");
	});

	test("escapes all of it when raw HTML is disabled", () => {
		const html = renderMarkdown("<details>\n<summary>x</summary>\n</details>", "", { html: false });
		expect(html).toContain("&lt;details&gt;");
		expect(html).toContain("&lt;summary&gt;x&lt;/summary&gt;");
		expect(html).not.toContain("<details>");
	});
});

describe("Markdown safety", () => {
	test("suppresses a script block, and escapes it when html is off", () => {
		expect(renderMarkdown("<script>alert(1)</script>")).toBe("");
		const escaped = renderMarkdown("<script>alert(1)</script>", "", { html: false });
		expect(escaped).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(escaped).not.toContain("<script>");
	});

	test("sanitizes an image inside a link label", () => {
		const html = renderMarkdown("[<img src=x onerror=alert(1)>](https://e)");
		expect(html).toContain('<img class="md-img" src="/raw/x" alt=""');
		expect(html).not.toContain("onerror");
		expect(renderMarkdown("[<img src=x onerror=alert(1)>](https://e)", "", { html: false })).toContain(
			"&lt;img src=x onerror=alert(1)&gt;",
		);
	});

	test("handles CRLF and empty input", () => {
		const html = renderMarkdown("# a\r\n\r\nb");
		expect(html).toContain('<h2 id="a">a</h2>');
		expect(html).toContain("<p>b</p>");
		expect(renderMarkdown("")).toBe("");
	});
});

/** Sanitize one block as a complete document, closing whatever it left open. */
function block(source: string, baseDir = ""): string {
	const sink = createHtmlSink();
	return sanitizeHtmlBlock(source, baseDir, sink) + closeHtmlSink(sink);
}

describe("raw HTML structure", () => {
	test("keeps an allowlisted element and its text", () => {
		expect(block("<details>\n<summary>More</summary>\nplain\n</details>")).toContain("<details>");
		expect(block("<details open>")).toBe("<details open></details>");
		expect(block("<div id=top title='A &amp; B'>x</div>")).toBe('<div id="top" title="A &amp; B">x</div>');
	});

	test("drops class and style, event handlers, and unknown attributes", () => {
		expect(block('<div class="bf-card__head" style="position:fixed">x</div>')).toBe("<div>x</div>");
		expect(block("<span style='color:red'>x</span>")).toBe("<span>x</span>");
		expect(block('<img src="a.png" onerror="alert(1)" onload=alert(2)>')).toBe(
			'<img class="md-img" src="/raw/a.png" alt="" loading="lazy" decoding="async">',
		);
		expect(block('<div onclick="x" data-whatever="y">t</div>')).toBe("<div>t</div>");
	});

	test("re-emits void and self-closing elements", () => {
		expect(block("<br>")).toBe("<br>");
		expect(block("<hr/>")).toBe("<hr>");
		expect(block("<wbr>")).toBe("<wbr>");
	});

	test("balances an unclosed element and drops a stray end tag", () => {
		expect(block("<div><span>x")).toBe("<div><span>x</span></div>");
		expect(block("<div>x</div></div>")).toBe("<div>x</div>");
		expect(block("<div>x</section></div>")).toBe("<div>x</div>");
		expect(block("<details><div>x</details>")).toBe("<details><div>x</div></details>");
	});

	test("drops comments, declarations, and processing instructions", () => {
		expect(block("<!-- hidden -->")).toBe("");
		expect(block("<!DOCTYPE html>")).toBe("");
		expect(block("<?xml version='1.0'?>")).toBe("");
	});

	test("escapes a disallowed element and malformed markup instead of guessing", () => {
		expect(block("<center>x</center>")).toBe("&lt;center&gt;x&lt;/center&gt;");
		expect(block("<custom-tag a=1>")).toBe("&lt;custom-tag a=1&gt;");
		expect(block('<a href="x"')).toBe('&lt;a href="x"');
		expect(block("1 < 2")).toBe("1 &lt; 2");
		expect(block("<3")).toBe("&lt;3");
	});

	test("keeps preformatted text inert and lets the browser decode references", () => {
		expect(block("<pre><code>a < b & c</code></pre>")).toBe("<pre><code>a &lt; b & c</code></pre>");
		expect(block("<p>AT&amp;T &copy;</p>")).toBe("<p>AT&amp;T &copy;</p>");
		expect(block("<p>&lt;script&gt;</p>")).toBe("<p>&lt;script&gt;</p>");
	});

	test("lowercases tag and attribute names", () => {
		expect(block("<DETAILS OPEN><SUMMARY>S</SUMMARY></DETAILS>")).toBe("<details open><summary>S</summary></details>");
	});
});

describe("raw HTML elements and attributes", () => {
	test("drops a suppressed element with its body, including an unclosed one", () => {
		expect(block("<script>alert(1)</script>")).toBe("");
		expect(block("<style>body{display:none}</style>")).toBe("");
		expect(block('<svg><path d="M0 0"/></svg>')).toBe("");
		expect(block("<iframe src='https://e'>x</iframe>")).toBe("");
		expect(block("<template><b>x</b></template>")).toBe("");
		expect(block("<svg>\n<path d='M0 0'/>")).toBe("");
	});

	test("resolves links and images through the shared URL policy", () => {
		expect(block('<a href="docs/x.md">x</a>', "sub")).toBe('<a href="/view/sub/docs/x.md">x</a>');
		expect(block('<a href="#usage">x</a>')).toBe('<a href="#usage">x</a>');
		expect(block('<a href="https://e">x</a>')).toBe(
			'<a href="https://e" target="_blank" rel="noopener noreferrer">x</a>',
		);
		expect(block('<img src="i.png" alt="pic" width="20" height="10">', "docs")).toBe(
			'<img class="md-img" src="/raw/docs/i.png" alt="pic" width="20" height="10" loading="lazy" decoding="async">',
		);
		expect(block('<img src="i.png" alt="pic" title="t">')).toContain('title="t"');
	});

	test("degrades an unsafe or external image", () => {
		expect(block('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
		expect(block('<img src="data:image/png;base64,AAA" alt="dot">')).toBe("dot");
		expect(block('<img src="../../secret.png" alt="nope">')).toBe("nope");
		expect(block('<img src="https://e/i.png" alt="badge">')).toBe(
			'<a href="https://e/i.png" target="_blank" rel="noopener noreferrer">badge</a>',
		);
		expect(block('<img src="https://e/i.png">')).toContain(">https://e/i.png</a>");
	});

	test("cannot break out of an attribute value", () => {
		const html = block(`<a href="a.md" title='x" onmouseover="alert(1)'>t</a>`);
		expect(html).toContain('title="x&quot; onmouseover=&quot;alert(1)"');
		expect(html).not.toContain('" onmouseover="');
	});

	test("takes the first duplicate attribute and decodes entities in values", () => {
		expect(block('<a href="a.md" href="javascript:x">t</a>')).toBe('<a href="/view/a.md">t</a>');
		expect(block('<a href="a&amp;b.md">t</a>')).toBe('<a href="/view/a%26b.md">t</a>');
	});

	test("keeps the table and list attributes it understands", () => {
		expect(block('<td colspan="2" rowspan="3" style="x">c</td>')).toBe('<td colspan="2" rowspan="3">c</td>');
		expect(block('<th scope="col" colspan="x">h</th>')).toBe('<th scope="col">h</th>');
		expect(block('<th scope="evil">h</th>')).toBe("<th>h</th>");
		expect(block('<ol start="3"><li value="7">x</li></ol>')).toBe('<ol start="3"><li value="7">x</li></ol>');
		expect(block('<time datetime="2026-01-01">then</time>')).toBe('<time datetime="2026-01-01">then</time>');
	});
});

describe("inline HTML", () => {
	test("accepts phrasing tags and settles leftover opens", () => {
		const stack: string[] = [];
		expect(sanitizeInlineTag("<kbd>Ctrl</kbd>", 0, "", stack)).toEqual({ html: "<kbd>", end: 5 });
		expect(sanitizeInlineTag("<kbd>Ctrl</kbd>", 9, "", stack)).toEqual({ html: "</kbd>", end: 15 });
		expect(stack).toEqual([]);
	});

	test("declines block, unknown, and non-tag input", () => {
		expect(sanitizeInlineTag("<div>", 0, "", [])).toBeUndefined();
		expect(sanitizeInlineTag("<center>", 0, "", [])).toBeUndefined();
		expect(sanitizeInlineTag("<https://e>", 0, "", [])).toBeUndefined();
		expect(sanitizeInlineTag("x", 0, "", [])).toBeUndefined();
	});

	test("drops an inline suppressed element and an unmatched end tag", () => {
		expect(sanitizeInlineTag("a<script>x</script>b", 1, "", [])).toEqual({ html: "", end: 19 });
		expect(sanitizeInlineTag("a<!-- note -->b", 1, "", [])).toEqual({ html: "", end: 14 });
		expect(sanitizeInlineTag("</b>", 0, "", [])).toEqual({ html: "", end: 4 });
	});
});

describe("HTML block detection", () => {
	test("recognizes allowed blocks, suppressed blocks, and comments", () => {
		expect(htmlBlockStart("<details>")).toEqual({ kind: "html" });
		expect(htmlBlockStart("</details>")).toEqual({ kind: "html" });
		expect(htmlBlockStart("  <table>")).toEqual({ kind: "html" });
		expect(htmlBlockStart("<!-- note -->")).toEqual({ kind: "html" });
		expect(htmlBlockStart("<script>")).toEqual({ kind: "suppressed", name: "script" });
		expect(htmlBlockStart("</svg>")).toEqual({ kind: "suppressed", name: "svg" });
	});

	test("leaves phrasing tags, indented code, and text alone", () => {
		expect(htmlBlockStart("<kbd>Ctrl</kbd>")).toBeUndefined();
		expect(htmlBlockStart("    <details>")).toBeUndefined();
		expect(htmlBlockStart("text <details>")).toBeUndefined();
	});

	test("finds the close of a suppressed element", () => {
		expect(closesSuppressed("</script>", "script")).toBe(true);
		expect(closesSuppressed("</SCRIPT >", "script")).toBe(true);
		expect(closesSuppressed("</style>", "script")).toBe(false);
	});
});

describe("sanitizer invariant", () => {
	const ALLOWED = [
		"a",
		"abbr",
		"article",
		"aside",
		"b",
		"blockquote",
		"br",
		"caption",
		"cite",
		"code",
		"dd",
		"del",
		"details",
		"div",
		"dl",
		"dt",
		"em",
		"figcaption",
		"figure",
		"footer",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"header",
		"hr",
		"i",
		"img",
		"ins",
		"kbd",
		"li",
		"mark",
		"nav",
		"ol",
		"p",
		"pre",
		"q",
		"s",
		"samp",
		"section",
		"small",
		"span",
		"strong",
		"sub",
		"summary",
		"sup",
		"table",
		"tbody",
		"td",
		"tfoot",
		"th",
		"thead",
		"time",
		"tr",
		"u",
		"ul",
		"var",
		"wbr",
	];
	const FRAGMENTS = [
		"<script>",
		"</script>",
		"javascript:",
		"data:",
		'"',
		"'",
		"&",
		"<",
		">",
		"onerror=",
		"style=",
		"class=",
		"<!--",
		"-->",
		"<img src=x onerror=1>",
		"<a href=",
		"</a>",
		"<div>",
		"</div>",
		"`",
		"|",
		"#",
		"\n",
		" ",
		"x",
		"<svg>",
		"</svg>",
		"<details>",
		"</details>",
		"[",
		"]",
		"(",
		")",
		"<kbd>",
		"<td colspan=2>",
	];

	/** A deterministic LCG, so a failure is reproducible from its seed. */
	function random(seed: number): () => number {
		let state = seed >>> 0;
		return () => {
			state = (state * 1664525 + 1013904223) >>> 0;
			return state / 2 ** 32;
		};
	}

	test("every emitted tag is well-formed and carries only allowlisted attributes", () => {
		const next = random(20261020);
		const ALLOWED_ATTRS = new Set([
			"id",
			"title",
			"href",
			"target",
			"rel",
			"open",
			"start",
			"value",
			"colspan",
			"rowspan",
			"scope",
			"datetime",
			"src",
			"alt",
			"width",
			"height",
			"class",
			"loading",
			"decoding",
		]);
		for (let round = 0; round < 250; round++) {
			let source = "";
			const length = 1 + Math.floor(next() * 24);
			for (let part = 0; part < length; part++) source += FRAGMENTS[Math.floor(next() * FRAGMENTS.length)];
			const html = block(source);
			expect(html).not.toMatch(/<script/i);
			expect(html).not.toMatch(/<(style|svg|iframe)/i);
			for (const tag of html.match(/<[^>]*>/g) ?? []) {
				const match = /^<(\/?)([a-z][a-z0-9-]*)((?: [a-z][a-z0-9-]*="[^"]*")*)\s*>$/.exec(tag);
				expect(match).not.toBeNull();
				if (match === null) continue;
				expect(ALLOWED).toContain(match[2]);
				for (const attribute of match[3].matchAll(/ ([a-z][a-z0-9-]*)="/g)) {
					expect(ALLOWED_ATTRS).toContain(attribute[1]);
				}
				expect(tag).not.toMatch(/(?:href|src)="(?:javascript|data):/i);
				expect(tag).not.toMatch(/^<[a-z][a-z0-9-]* class="(?!md-img")/);
			}
		}
	});
});

describe("browser script", () => {
	test("ships two scripts that parse", () => {
		expect(() => new Function(CLIENT_JS)).not.toThrow();
		expect(() => new Function(LIVE_CLIENT_JS)).not.toThrow();
	});

	test("assembles the client from its fragments", () => {
		expect(() => new Function(TREE_CLIENT_JS)).not.toThrow();
		expect(() => new Function(PALETTE_CLIENT_JS)).not.toThrow();
		expect(CLIENT_JS).toContain(TREE_CLIENT_JS);
		expect(CLIENT_JS).toContain(PALETTE_CLIENT_JS);
	});

	test("fetches nothing from another origin", () => {
		const source = CLIENT_JS.replaceAll("http://www.w3.org/2000/svg", "");
		expect(source).not.toContain("http");
		expect(source).not.toContain("//cdn");
	});

	test("paints live status as text, never as markup", () => {
		expect(LIVE_CLIENT_JS).not.toContain("innerHTML");
		expect(LIVE_CLIENT_JS).not.toContain("insertAdjacentHTML");
		expect(LIVE_CLIENT_JS).not.toContain("outerHTML");
		expect(LIVE_CLIENT_JS).toContain("textContent");
	});

	test("leaves the shortcut sheet's Esc to the shared dialog runtime", () => {
		// The kit's capture listener closes the sheet; a second copy in the page
		// keymap is the drift this shared runtime exists to prevent.
		expect(CLIENT_JS).not.toContain("window.bfKeys.close()");
	});

	test("names the live state instead of counting it", () => {
		// The chip is a state, not a stopwatch: no label carries an elapsed time, and
		// nothing repaints it between frames. Staleness is one timeout armed per
		// frame, and the fragment's one interval checks the folder's revision — it
		// never paints the chip.
		expect(LIVE_CLIENT_JS).toContain('setLiveTone("success", "live")');
		expect(LIVE_CLIENT_JS).toContain('setLiveTone("warn", "stale")');
		expect(LIVE_CLIENT_JS).not.toMatch(/setInterval\([^)]*paint/);
	});

	test("asks the server about the folder it drew before offering a reload", () => {
		// A page that lists a folder carries what it drew; a difference is the only
		// thing that reveals the control, and the control is what fixes the page.
		expect(LIVE_CLIENT_JS).toContain('getAttribute("data-dir")');
		expect(LIVE_CLIENT_JS).toContain('getAttribute("data-rev")');
		expect(LIVE_CLIENT_JS).toContain("/api/dir-rev?path=");
		expect(LIVE_CLIENT_JS).toContain('getElementById("reload-hint")');
		expect(LIVE_CLIENT_JS).toContain("window.location.reload()");
	});

	test("serves the client as a no-store script and the theme bootstrap before paint", async () => {
		const root = "/srv/aurora";
		const script = await handleRequest({ root, config: DEFAULT_CONFIG }, "GET", "/app.js", {});
		expect(script.status).toBe(200);
		expect(script.headers["Content-Type"]).toContain("text/javascript");
		expect(script.headers["Cache-Control"]).toBe("no-store");
		expect(script.body).toBe(CLIENT_JS);

		const theme = await handleRequest({ root, config: DEFAULT_CONFIG }, "GET", "/theme.js", {});
		expect(theme.status).toBe(200);
		expect(theme.headers["Content-Type"]).toContain("text/javascript");
		expect(theme.body).toBe(THEME_JS);
		expect(THEME_JS).toContain(WEB_THEME_STORAGE_KEY);
		expect(THEME_JS).toContain("data-theme");
	});
});
