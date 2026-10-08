import { afterEach, describe, expect, test } from "bun:test";
import type { Listing, TreeNode } from "../../extensions/serve/files.ts";
import {
	encodePath,
	escapeHtml,
	formatDate,
	renderBreadcrumbs,
	renderDirectoryPage,
	renderFilePage,
} from "../../extensions/serve/html.ts";
import { makeFixture, type Fixture } from "./helpers.ts";

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
	kind: "directory",
	children: [
		{
			name: "sub",
			rel: "sub",
			isDir: true,
			isImage: false,
			kind: "directory",
			children: [{ name: "b.md", rel: "sub/b.md", isDir: false, isImage: false, kind: "text", children: [] }],
		},
		{ name: 'a"<b>.txt', rel: 'a"<b>.txt', isDir: false, isImage: false, kind: "text", children: [] },
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
		const ms = new Date(2026, 9, 8, 20, 31).getTime();
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
					mtimeMs: Date.now(),
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
					mtimeMs: Date.now(),
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
					mtimeMs: Date.now(),
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
						mtimeMs: Date.now(),
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
				mtimeMs: Date.now(),
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
						mtimeMs: Date.now(),
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
		expect(html).toContain('<button type="button" class="tw" aria-expanded="true"');
		expect(html).toContain('<span class="tw spacer" aria-hidden="true"></span>');
		expect(html).toContain('id="tree-empty"');
	});

	test("renders an image", () => {
		fixture = makeFixture();
		const html = renderFilePage({
			rootLabel: fixture.root,
			rel: "image.png",
			tree,
			maxFileBytes: 1_000_000,
			file: { kind: "image", size: 68, mtimeMs: Date.now(), mime: "image/png" },
		});
		expect(html).toContain(`<img src="/raw/image.png"`);
	});
});
