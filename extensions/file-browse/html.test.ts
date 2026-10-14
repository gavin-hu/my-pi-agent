import { afterEach, describe, expect, test } from "bun:test";
import type { Listing, TreeNode } from "./files.ts";
import { formatDate, renderBreadcrumbs, renderDirectoryPage, renderFilePage } from "./html.ts";
import { makeFixture, localTimeMs, type Fixture } from "../../test/helpers/fixtures/file-browse.ts";

/** A fixed mtime so date rendering is deterministic. */
const MTIME_MS = 1_700_000_000_000;

let fixture: Fixture | undefined;

afterEach(() => {
	fixture?.remove();
	fixture = undefined;
});

const tree: TreeNode = {
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

describe("formatDate", () => {
	test("formats a timestamp", () => {
		const ms = localTimeMs(2026, 9, 8, 20, 31);
		expect(formatDate(ms)).toBe("Oct 8 20:31");
		expect(formatDate(Number.NaN)).toBe("—");
	});
});

describe("renderBreadcrumbs", () => {
	test("renders ancestors as links and the last segment as current", () => {
		const html = renderBreadcrumbs("sub/extensions");
		expect(html).toContain(`<a href="/browse/sub">sub</a>`);
		expect(html).toContain(`<span aria-current="page">extensions</span>`);
	});

	test("marks home current at the root", () => {
		expect(renderBreadcrumbs("")).toContain(`aria-current="page">home</span>`);
	});
});

describe("renderDirectoryPage", () => {
	test("escapes names, marks the current node, and adds thumbnails", () => {
		fixture = makeFixture();
		const listing: Listing = {
			entries: [
				{
					name: "sub",
					rel: "sub",
					isDir: true,
					isSymlink: false,
					broken: false,
					size: 0,
					mtimeMs: MTIME_MS,
					kind: "directory",
					isImage: false,
				},
				{
					name: "image.png",
					rel: "image.png",
					isDir: false,
					isSymlink: false,
					broken: false,
					size: 100,
					mtimeMs: MTIME_MS,
					kind: "image",
					isImage: true,
				},
				{
					name: 'a"<b>.txt',
					rel: 'a"<b>.txt',
					isDir: false,
					isSymlink: false,
					broken: false,
					size: 5,
					mtimeMs: MTIME_MS,
					kind: "text",
					isImage: false,
				},
			],
			total: 3,
			truncated: false,
		};
		const html = renderDirectoryPage({
			rootLabel: fixture.root,
			rel: "sub",
			listing,
			tree,
			thumbnails: true,
			maxThumbBytes: 5_000_000,
		});
		expect(html).toContain(`aria-current="page"`);
		expect(html).toContain(`<img class="bf-table__thumb"`);
		expect(html).toContain("&lt;b&gt;");
		expect(html).not.toContain(`a"<b>`);
		expect(html).toContain("read-only");
	});

	test("reports truncation and empty folders", () => {
		fixture = makeFixture();
		const empty = renderDirectoryPage({
			rootLabel: fixture.root,
			rel: "",
			listing: { entries: [], total: 0, truncated: false },
			tree,
			thumbnails: false,
			maxThumbBytes: 0,
		});
		expect(empty).toContain("This folder is empty.");
		const truncated = renderDirectoryPage({
			rootLabel: fixture.root,
			rel: "",
			listing: {
				entries: [
					{
						name: "one",
						rel: "one",
						isDir: false,
						isSymlink: false,
						broken: false,
						size: 1,
						mtimeMs: MTIME_MS,
						kind: "text",
						isImage: false,
					},
				],
				total: 5,
				truncated: true,
			},
			tree,
			thumbnails: false,
			maxThumbBytes: 0,
		});
		expect(truncated).toContain("first 1 of 5");
	});
});

describe("renderFilePage", () => {
	test("renders text lines with the download link", () => {
		fixture = makeFixture();
		const html = renderFilePage({
			rootLabel: fixture.root,
			rel: "a.txt",
			tree,
			maxFileBytes: 1_000_000,
			file: {
				kind: "text",
				lines: ["hello", ""],
				truncated: false,
				totalLines: 2,
				size: 12,
				mtimeMs: MTIME_MS,
				mime: "application/octet-stream",
			},
		});
		expect(html).toContain(`<span class="bf-code__line">hello</span>`);
		expect(html).toContain(`href="/raw/a.txt"`);
	});

	test("highlights a code file but leaves plain text alone", () => {
		fixture = makeFixture();
		const file = {
			kind: "text" as const,
			lines: ["const x = 1;"],
			truncated: false,
			totalLines: 1,
			size: 12,
			mtimeMs: MTIME_MS,
			mime: "text/plain",
		};
		const js = renderFilePage({ rootLabel: fixture.root, rel: "a.js", tree, maxFileBytes: 1_000_000, file });
		expect(js).toContain(`<span class="tok-keyword">const</span>`);
		const txt = renderFilePage({ rootLabel: fixture.root, rel: "a.txt", tree, maxFileBytes: 1_000_000, file });
		expect(txt).toContain(`<span class="bf-code__line">const x = 1;</span>`);
	});

	test("includes the UI hardening markers", () => {
		fixture = makeFixture();
		const html = renderDirectoryPage({
			rootLabel: fixture.root,
			rel: "",
			listing: {
				entries: [
					{
						name: "sub",
						rel: "sub",
						isDir: true,
						isSymlink: false,
						broken: false,
						size: 0,
						mtimeMs: MTIME_MS,
						kind: "directory",
						isImage: false,
					},
				],
				total: 1,
				truncated: false,
			},
			tree,
			thumbnails: false,
			maxThumbBytes: 0,
		});
		expect(html).toContain('<meta name="color-scheme" content="dark light">');
		expect(html).toContain("color-scheme:dark}");
		expect(html).toContain(':root[data-theme="light"]');
		expect(html).toContain(":root:not([data-theme])");
		expect(html).toContain('id="theme-toggle"');
		expect(html).toContain('src="/theme.js"');
		expect(html).toContain("table-layout:fixed");
		expect(html).toContain('<button type="button" class="bf-tree__tw bf-tree__tw--toggle" aria-expanded="true"');
		expect(html).toContain('<span class="bf-tree__tw bf-tree__tw--spacer" aria-hidden="true"></span>');
		expect(html).toContain('id="tree-empty"');
		expect(html).toContain('href="#main"');
		expect(html).toContain('id="main"');
		expect(html).toContain("browse-heading");
		expect(html).toContain(":focus-within");
		expect(html).toContain("th .bf-sort{pointer-events:none");
		expect(html).toContain('id="copy-status"');
		expect(html).toContain(".sr-only{");
		expect(html).toContain('<details class="bf-app__sidebar" open>');
		expect(html).toContain('<summary class="bf-panel__summary">');
		expect(html).not.toContain("max-width:1400px");
		expect(html).not.toContain("max-width:1200px");
		expect(html).toContain(
			".bf-app__main{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:auto;padding:var(--space-5) var(--space-6)}",
		);
		expect(html).toContain(
			".bf-code{margin:0;padding:var(--space-3) 0 var(--space-4);flex:1 1 auto;min-height:0;overflow:auto;",
		);
		expect(html).toContain(".bf-panel{min-width:0;overflow:auto;overscroll-behavior:contain}");
		expect(html).toContain(".bf-app__body{flex:1 1 auto;min-height:0;display:grid");
		expect(html).toContain("overscroll-behavior:contain");
		expect(html).toContain("flex-wrap:wrap");
		expect(html).toContain(".browse-git--dirty .browse-git__glyph");
		expect(html).toContain("<noscript>");
		expect(html).toContain(".bf-tree__tw--toggle{visibility:hidden}");
		expect(html).toContain(".bf-tree__tw--toggle::after");
		expect(html).toContain("li[data-loading]");
		expect(html).toContain("li[data-error]");
		expect(html).toContain('data-path="sub"');
		expect(html).toContain('data-path="sub/b.md"');
	});

	test("renders the git chip with branch and dirty state", () => {
		fixture = makeFixture();
		const html = renderDirectoryPage({
			rootLabel: fixture.root,
			rel: "",
			listing: { entries: [], total: 0, truncated: false },
			tree,
			thumbnails: false,
			maxThumbBytes: 0,
			git: { branch: "main", dirty: true },
		});
		expect(html).toContain('class="bf-chip browse-git browse-git--dirty"');
		expect(html).toContain('aria-label="git branch main, uncommitted changes"');
		expect(html).toContain("browse-dirty");
	});

	test("omits the git chip without a status", () => {
		fixture = makeFixture();
		const html = renderDirectoryPage({
			rootLabel: fixture.root,
			rel: "",
			listing: { entries: [], total: 0, truncated: false },
			tree,
			thumbnails: false,
			maxThumbBytes: 0,
		});
		expect(html).not.toContain('class="bf-chip browse-git');
	});

	test("renders a broken symlink as a non-link", () => {
		fixture = makeFixture();
		const html = renderDirectoryPage({
			rootLabel: fixture.root,
			rel: "",
			listing: {
				entries: [
					{
						name: "dangling",
						rel: "dangling",
						isDir: false,
						isSymlink: true,
						broken: true,
						size: 0,
						mtimeMs: MTIME_MS,
						kind: "binary",
						isImage: false,
					},
				],
				total: 1,
				truncated: false,
			},
			tree,
			thumbnails: false,
			maxThumbBytes: 0,
		});
		expect(html).toContain('class="browse-broken" title="broken symbolic link"');
		expect(html).not.toContain('href="/view/dangling"');
	});

	test("renders an image", () => {
		fixture = makeFixture();
		const html = renderFilePage({
			rootLabel: fixture.root,
			rel: "image.png",
			tree,
			maxFileBytes: 1_000_000,
			file: { kind: "image", size: 68, mtimeMs: MTIME_MS, mime: "image/png" },
		});
		expect(html).toContain(`<img src="/raw/image.png"`);
	});

	test("renders a Markdown page with a raw toggle and copy actions", () => {
		fixture = makeFixture();
		const html = renderFilePage({
			rootLabel: fixture.root,
			rel: "sub/b.md",
			tree,
			maxFileBytes: 1_000_000,
			file: {
				kind: "markdown",
				lines: ["# hi", "", "some **bold** text"],
				truncated: false,
				totalLines: 3,
				size: 30,
				mtimeMs: MTIME_MS,
				mime: "application/octet-stream",
			},
		});
		expect(html).toContain('<div class="bf-md">');
		expect(html).toContain("<h1>hi</h1>");
		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain('href="/view/sub/b.md?raw=1"');
		expect(html).toContain('data-copy="content"');
		expect(html).toContain('data-value="sub/b.md"');
		expect(html).not.toContain('id="wrap-toggle"');
	});

	test("renders raw Markdown with a wrap toggle and a rendered link", () => {
		fixture = makeFixture();
		const html = renderFilePage({
			rootLabel: fixture.root,
			rel: "sub/b.md",
			tree,
			maxFileBytes: 1_000_000,
			markdownRaw: true,
			file: {
				kind: "markdown",
				lines: ["# hi"],
				truncated: false,
				totalLines: 1,
				size: 5,
				mtimeMs: MTIME_MS,
				mime: "application/octet-stream",
			},
		});
		expect(html).toContain('<pre class="bf-code bf-code--numbered">');
		expect(html).toContain('id="wrap-toggle"');
		expect(html).toContain('href="/view/sub/b.md"');
		expect(html).not.toContain('class="bf-md"');
	});
});

describe("renderDirectoryPage sort and styles", () => {
	test("marks rows with sort keys and headers as sortable", () => {
		fixture = makeFixture();
		const html = renderDirectoryPage({
			rootLabel: fixture.root,
			rel: "",
			listing: {
				entries: [
					{
						name: "sub",
						rel: "sub",
						isDir: true,
						isSymlink: false,
						broken: false,
						size: 0,
						mtimeMs: MTIME_MS,
						kind: "directory",
						isImage: false,
					},
					{
						name: "a.txt",
						rel: "a.txt",
						isDir: false,
						isSymlink: false,
						broken: false,
						size: 12,
						mtimeMs: MTIME_MS,
						kind: "text",
						isImage: false,
					},
				],
				total: 2,
				truncated: false,
			},
			tree,
			thumbnails: false,
			maxThumbBytes: 0,
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

	test("ships the markdown, sort, wrap, and action styles", () => {
		fixture = makeFixture();
		const html = renderDirectoryPage({
			rootLabel: fixture.root,
			rel: "",
			listing: { entries: [], total: 0, truncated: false },
			tree,
			thumbnails: false,
			maxThumbBytes: 0,
		});
		expect(html).toContain(".bf-code--wrap .bf-code__line{white-space:pre-wrap");
		expect(html).toContain(".tok-keyword{color:var(--tok-keyword)}");
		expect(html).toContain(".bf-md{");
		expect(html).toContain('.bf-segmented__item[aria-current="page"]');
		expect(html).toContain(".bf-btn{display:none}");
		expect(html).toContain(".bf-theme-toggle{");
	});

	test("ships the quick-open trigger and palette styles", () => {
		fixture = makeFixture();
		const html = renderDirectoryPage({
			rootLabel: fixture.root,
			rel: "",
			listing: { entries: [], total: 0, truncated: false },
			tree,
			thumbnails: false,
			maxThumbBytes: 0,
		});
		expect(html).toContain('id="quick-open"');
		expect(html).toContain('aria-haspopup="dialog"');
		expect(html).toContain(".browse-quick-open{display:none}");
		expect(html).toContain(".bf-dialog{");
		expect(html).toContain('.bf-dialog__option[aria-selected="true"]');
	});
});
