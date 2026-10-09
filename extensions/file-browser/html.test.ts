import { afterEach, describe, expect, test } from "bun:test";
import type { Listing, TreeNode } from "./files.ts";
import { encodePath, escapeHtml, formatDate, renderBreadcrumbs, renderDirectoryPage, renderFilePage } from "./html.ts";
import { makeFixture, localTimeMs, type Fixture } from "../../test/helpers/fixtures/file-browser.ts";

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

describe("escapeHtml", () => {
	test("escapes every HTML-significant character", () => {
		expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
	});
});

describe("encodePath", () => {
	test("encodes segments but keeps separators", () => {
		expect(encodePath("sub/a b#c.ts")).toBe("sub/a%20b%23c.ts");
		expect(encodePath("")).toBe("");
	});
});

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
		expect(html).toContain(`<img class="thumb"`);
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
		expect(html).toContain(`<span class="line">hello</span>`);
		expect(html).toContain(`href="/raw/a.txt"`);
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
		expect(html).toContain("color-scheme:dark light");
		expect(html).toContain("table-layout:fixed");
		expect(html).toContain('<button type="button" class="tw toggle" aria-expanded="true"');
		expect(html).toContain('<span class="tw spacer" aria-hidden="true"></span>');
		expect(html).toContain('id="tree-empty"');
		expect(html).toContain('href="#main"');
		expect(html).toContain('id="main"');
		expect(html).toContain('<details class="side-panel" open>');
		expect(html).toContain('<summary class="side-summary">');
		expect(html).not.toContain("max-width:1400px");
		expect(html).not.toContain("max-width:1200px");
		expect(html).toContain(
			"main.content{padding:20px 24px;min-width:0;min-height:0;display:flex;flex-direction:column;overflow-y:auto}",
		);
		expect(html).toContain("pre.code{margin:0;padding:12px 0 16px;flex:1 1 auto;min-height:0;overflow:auto;");
		expect(html).toContain("aside.side{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;");
		expect(html).toContain(".shell{flex:1 1 auto;min-height:0;display:grid");
		expect(html).toContain("overscroll-behavior:contain");
		expect(html).toContain("flex-wrap:wrap");
		expect(html).toContain(".git .dirty-dot");
		expect(html).toContain("<noscript>");
		expect(html).toContain(".tw.toggle{visibility:hidden}");
		expect(html).toContain(".tw.toggle::after");
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
		expect(html).toContain('class="git dirty"');
		expect(html).toContain('aria-label="git branch main, uncommitted changes"');
		expect(html).toContain("dirty-dot");
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
		expect(html).not.toContain('class="git');
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
		expect(html).toContain('class="broken" title="broken symbolic link"');
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
});
