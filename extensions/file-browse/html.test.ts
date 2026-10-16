import { afterEach, describe, expect, test } from "bun:test";
import type { Listing, TreeNode } from "./files.ts";
import { changeDirs, type ChangedFile } from "./diff.ts";
import {
	formatDate,
	renderBreadcrumbs,
	renderDiffLines,
	renderDiffPage,
	renderDirectoryPage,
	renderFileDiffPage,
	renderFilePage,
	type ChangeSummary,
} from "./html.ts";
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
	test("renders ancestor segments as links and stops before the current page", () => {
		const html = renderBreadcrumbs("sub/extensions");
		expect(html).toContain(`<a href="/browse/sub">sub</a>`);
		expect(html).not.toContain("extensions</span>");
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
		expect(html).toContain('<article class="bf-md">');
		expect(html).toContain('<h2 id="hi">hi</h2>');
		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain('href="/view/sub/b.md?raw=1"');
		expect(html).toContain('data-copy="content"');
		expect(html).toContain('data-value="sub/b.md"');
		expect(html).not.toContain('id="wrap-toggle"');
	});

	test("adds an on-this-page outline for a document with several headings", () => {
		fixture = makeFixture();
		const root = fixture.root;
		const page = (lines: string[]) =>
			renderFilePage({
				rootLabel: root,
				rel: "sub/b.md",
				tree,
				maxFileBytes: 1_000_000,
				file: {
					kind: "markdown",
					lines,
					truncated: false,
					totalLines: lines.length,
					size: 50,
					mtimeMs: MTIME_MS,
					mime: "application/octet-stream",
				},
			});
		const long = page(["# Title", "", "## One", "", "## Two", "", "### Deep"]);
		expect(long).toContain('<details class="browse-md-outline">');
		expect(long).toContain('<a class="lvl0" href="#title">Title</a>');
		expect(long).toContain('<a class="lvl1" href="#one">One</a>');
		expect(long).toContain('<a class="lvl2" href="#deep">Deep</a>');
		expect(page(["# Title", "", "## One"])).not.toContain('<details class="browse-md-outline">');
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
		expect(html).toContain(".browse-md-outline{");
		expect(html).toContain('.bf-segmented__item[aria-current="page"]');
		expect(html).toContain(".bf-btn{display:none}");
		expect(html).toContain(".bf-theme-toggle{");
		expect(html).toContain("@media (max-width:520px)");
		expect(html).toContain(".bf-toolbar .bf-theme-toggle{margin-left:auto}");
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

describe("diff view", () => {
	const changed = (partial: Partial<ChangedFile>): ChangedFile => ({
		rel: "a.ts",
		index: " ",
		worktree: "M",
		untracked: false,
		...partial,
	});

	const summary = (files: ChangedFile[], insertions = 0, deletions = 0): ChangeSummary => ({
		count: files.length,
		insertions,
		deletions,
		files: new Set(files.map((file) => file.rel)),
		dirs: changeDirs(files),
	});

	test("renders the header changes chip only when there are changes", () => {
		fixture = makeFixture();
		const base = {
			rootLabel: fixture.root,
			rel: "",
			listing: { entries: [], total: 0, truncated: false },
			tree,
			thumbnails: false,
			maxThumbBytes: 0,
		};
		const two = renderDirectoryPage({
			...base,
			summary: summary([changed({ rel: "a.ts" }), changed({ rel: "b.ts" })], 12, 4),
		});
		expect(two).toContain('class="bf-chip browse-diff" href="/diff"');
		expect(two).toContain("2 changes");
		expect(two).toContain("+12");
		expect(two).toContain("−4");
		expect(renderDirectoryPage({ ...base, summary: summary([changed({ rel: "a.ts" })]) })).toContain("1 change");
		expect(renderDirectoryPage({ ...base, summary: summary([]) })).not.toContain('browse-diff" href');
		expect(renderDirectoryPage(base)).not.toContain('class="bf-chip browse-diff"');
	});

	test("marks changed files and their directories in the listing and tree", () => {
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
			summary: summary([changed({ rel: "sub/b.md" }), changed({ rel: "a.txt" })]),
		});
		expect(html).toContain('class="browse-change"');
		expect(html).toContain('title="uncommitted changes"');
		// The listing marks two rows and the tree marks the changed nodes.
		expect((html.match(/class="browse-change"/g) ?? []).length).toBeGreaterThanOrEqual(3);
	});

	test("renders a changes action on a changed file page", () => {
		fixture = makeFixture();
		const file = {
			kind: "text" as const,
			lines: ["x"],
			truncated: false,
			totalLines: 1,
			size: 1,
			mtimeMs: MTIME_MS,
			mime: "text/plain",
		};
		const page = { rootLabel: fixture.root, rel: "a.txt", tree, maxFileBytes: 1_000_000, file };
		expect(renderFilePage({ ...page, changed: true })).toContain('href="/diff/a.txt"');
		expect(renderFilePage(page)).not.toContain('href="/diff/a.txt"');
	});

	test("lists changed files with status, mode links, and the stat", () => {
		fixture = makeFixture();
		const rows = [
			changed({ rel: "a.ts", index: "M", worktree: " " }),
			changed({ rel: "new.txt", untracked: true, index: "?", worktree: "?" }),
			changed({ rel: "x/y.md", origRel: "y/x.md", index: "R", worktree: " " }),
		];
		const html = renderDiffPage({
			rootLabel: fixture.root,
			mode: "head",
			files: rows,
			stat: " a.ts | 2 +-\n 1 file changed",
			tree,
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
		fixture = makeFixture();
		const html = renderDiffPage({
			rootLabel: fixture.root,
			mode: "staged",
			files: [],
			stat: "",
			tree,
		});
		expect(html).toContain("No changes staged vs HEAD.");
		expect(html).toContain('aria-current="page">staged</a>');
	});

	test("escapes paths and stat text", () => {
		fixture = makeFixture();
		const html = renderDiffPage({
			rootLabel: fixture.root,
			mode: "head",
			files: [changed({ rel: 'a"<b>.ts' })],
			stat: "<script>alert(1)</script>",
			tree,
		});
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).toContain("a&quot;&lt;b&gt;.ts");
	});
});

describe("renderDiffLines", () => {
	test("marks each line kind with a gutter, sign, and class", () => {
		const html = renderDiffLines([
			{ kind: "meta", text: "diff --git a/a b/a" },
			{ kind: "hunk", text: "@@ -1 +1 @@" },
			{ kind: "ctx", text: "keep", oldNo: 1, newNo: 1 },
			{ kind: "del", text: "old", oldNo: 2 },
			{ kind: "add", text: "new", newNo: 2 },
			{ kind: "note", text: "\ No newline at end of file" },
		]);
		expect(html).toContain("bf-diff-line--hunk");
		expect(html).toContain("bf-diff-line--add");
		expect(html).toContain("bf-diff-line--del");
		expect(html).toContain("bf-diff-line--note");
		expect(html).toContain('<span class="browse-diff-no" aria-hidden="true">2</span>');
		expect(html).toContain('class="browse-diff-sign" aria-hidden="true">+</span>');
		expect(html).toContain('class="browse-diff-sign" aria-hidden="true">-</span>');
	});

	test("escapes diff content", () => {
		const html = renderDiffLines([{ kind: "add", text: "<img src=x onerror=alert(1)>", newNo: 1 }]);
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img");
	});

	test("highlights changed lines with the file language", () => {
		const html = renderDiffLines(
			[
				{ kind: "del", text: "const old = 1;", oldNo: 1 },
				{ kind: "add", text: "const next = 2;", newNo: 1 },
			],
			"ts",
		);
		expect(html.match(/tok-keyword/g)?.length).toBe(2);
	});
});

describe("renderFileDiffPage", () => {
	test("renders the diff with mode links that keep the path", () => {
		fixture = makeFixture();
		const html = renderFileDiffPage({
			rootLabel: fixture.root,
			rel: "sub/b.md",
			mode: "staged",
			tree,
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
		fixture = makeFixture();
		const base = { rootLabel: fixture.root, rel: "a.ts", mode: "head" as const, tree };
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
});

describe("viewing surface", () => {
	test("names the root listing after the served folder", () => {
		fixture = makeFixture();
		const html = renderDirectoryPage({
			rootLabel: "/srv/aurora",
			rel: "",
			listing: { entries: [], total: 0, truncated: false },
			tree,
			thumbnails: false,
			maxThumbBytes: 0,
		});
		expect(html).toContain('id="page-title">aurora</h1>');
		expect(html).not.toContain('id="page-title">/</h1>');
	});

	test("drops the octet-stream metadata and footers the path", () => {
		fixture = makeFixture();
		const html = renderFilePage({
			rootLabel: fixture.root,
			rel: "sub/b.md",
			tree,
			maxFileBytes: 1_000_000,
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
		expect(html).toContain("Markdown ·");
		expect(html).not.toContain("application/octet-stream");
		expect(html).toContain("read-only · sub/b.md</footer>");
	});

	test("measures the rendered Markdown column and ships the review chrome", () => {
		fixture = makeFixture();
		const html = renderFilePage({
			rootLabel: fixture.root,
			rel: "sub/b.md",
			tree,
			maxFileBytes: 1_000_000,
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
		expect(html).toContain('class="bf-app__main browse-page browse-measure"');
		expect(html).toContain("--browse-measure");
		expect(html).toContain('id="keys-open"');
		expect(html).toContain('id="keys-dialog" hidden');
		expect(html).toContain('id="progress-fill"');
		expect(html).toContain("Toggle rendered and raw");
		expect(html).toContain("/ ⌘K");
	});

	test("anchors hunk headers and summarises a file diff", () => {
		fixture = makeFixture();
		const lines = renderDiffLines([
			{ kind: "hunk", text: "@@ -1 +1 @@" },
			{ kind: "ctx", text: "keep", oldNo: 1, newNo: 1 },
			{ kind: "hunk", text: "@@ -9 +9 @@" },
		]);
		expect(lines).toContain('id="hunk-1" data-hunk="1"');
		expect(lines).toContain('id="hunk-2" data-hunk="2"');

		const html = renderFileDiffPage({
			rootLabel: fixture.root,
			rel: "a.ts",
			mode: "head",
			tree,
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
	});
});
