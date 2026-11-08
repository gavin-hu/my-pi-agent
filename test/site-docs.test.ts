/**
 * Structure guard for the documentation site.
 *
 * The site is Markdown, a JSON navigation table, and Liquid templates, and no
 * compiler reads any of it: a page with no navigation row disappears from the
 * sidebar, a row naming a page that was deleted links nowhere, and a screenshot
 * copied into `docs/assets/` stops matching the one the capture scripts write.
 * GitHub Pages builds the folder, so a defect here reaches a reader directly.
 *
 * What it cannot do is build the site: that needs Ruby and the Pages pipeline,
 * so the Liquid itself is reviewed and the shell is rendered by hand. These
 * cases hold the half a test can see — the data, the paths, and the assets.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import { walkFiles } from "./helpers/files.ts";
import { textOf } from "./helpers/scan.ts";

const root = join(import.meta.dir, "..");
const docs = join(root, "docs");

/** One navigation row, as `_data/docs.json` writes it. */
interface NavRow {
	path: string;
	title: string;
	group: string;
	summary: string;
}

/** The navigation table: the groups in order, and the page under each. */
interface NavData {
	groups: string[];
	pages: NavRow[];
}

const nav = JSON.parse(readFileSync(join(docs, "_data", "docs.json"), "utf-8")) as NavData;

/**
 * A page a reader opens: every Markdown file outside a `_`-prefixed build
 * directory. The contributor guides and the old docs map are superseded by the
 * site but kept until the content rewrite, so they are listed here rather than
 * linked: the navigation stays end-user.
 */
const UNLISTED = new Set(["README.md", "architecture.md", "development.md"]);

/** Every site page, relative to `docs/`, in walk order. */
function sitePages(): string[] {
	return walkFiles(docs)
		.filter((file) => file.endsWith(".md"))
		.map((file) => relative(docs, file).replaceAll("\\", "/"))
		.filter((path) => !path.split("/").some((part) => part.startsWith("_") || part.startsWith(".")))
		.sort();
}

/** A page's text, by its path under `docs/`. */
function pageText(path: string): string {
	return textOf(join(docs, path));
}

describe("the navigation table", () => {
	test("lists every site page, and names only pages that exist", () => {
		const listed = nav.pages.map((row) => row.path).sort();
		const missing = sitePages().filter((page) => !listed.includes(page) && !UNLISTED.has(page));
		const dangling = listed.filter((page) => !existsSync(join(docs, page)));
		expect({ missing, dangling }).toEqual({ missing: [], dangling: [] });
	});

	test("names each page and each path once", () => {
		const titles = nav.pages.map((row) => row.title);
		const paths = nav.pages.map((row) => row.path);
		expect([new Set(titles).size, new Set(paths).size]).toEqual([titles.length, paths.length]);
	});

	test("puts every page under a declared group, and uses every declared group", () => {
		const groups = new Set(nav.groups);
		const unknown = nav.pages.filter((row) => !groups.has(row.group)).map((row) => `${row.path}: ${row.group}`);
		const empty = nav.groups.filter((group) => !nav.pages.some((row) => row.group === group));
		expect({ unknown, empty }).toEqual({ unknown: [], empty: [] });
	});

	test("summarises every page, so search and the meta description have a sentence", () => {
		const missing = nav.pages.filter((row) => row.summary.trim() === "").map((row) => row.path);
		expect(missing).toEqual([]);
	});
});

describe("the build", () => {
	const config = readFileSync(join(docs, "_config.yml"), "utf-8");

	test("serves the project site under its own baseurl, and asks for clean URLs", () => {
		// Pages serves a project site at /<repo>/, so a root-absolute URL without
		// `relative_url` would 404 in production and work locally.
		expect(config).toContain('baseurl: "/my-pi-agent"');
		expect(config).toContain("permalink: pretty");
	});

	test("declares the one plugin the Markdown links need", () => {
		expect(config).toMatch(/plugins:\s*\n\s*- jekyll-relative-links/);
		expect(config).toMatch(/relative_links:\s*\n\s*enabled: true/);
	});

	test("gives every page the site's layout without front matter", () => {
		expect(config).toMatch(/defaults:[\s\S]*layout: "page"/);
	});

	test("keeps the search index out of the page layout", () => {
		// A JSON template wrapped in the shell would parse as HTML, not as JSON.
		const search = pageText("search.json");
		expect(search.startsWith("---\nlayout: null\n")).toBe(true);
		expect(search).toContain("permalink: /search.json");
	});

	test("ships a not-found page that wears the shell", () => {
		expect(pageText("404.html")).toContain("layout: default");
	});
});

describe("the assets the site shows", () => {
	test("are byte-identical to the assets the capture scripts write", () => {
		const copies = walkFiles(join(docs, "assets")).filter((file) => /\.(png|jpe?g|gif|svg|webp)$/.test(file));
		const stale = copies
			.map((copy) => ({ copy, source: join(root, relative(docs, copy)) }))
			.filter(({ source }) => existsSync(source))
			.filter(({ copy, source }) => !readFileSync(copy).equals(readFileSync(source)))
			.map(({ copy, source }) => `${relative(docs, copy)} differs from ${relative(root, source)}; copy it again`);
		expect(stale).toEqual([]);
	});

	test("are reachable from the pages that show them", () => {
		const missing = nav.pages
			.map((row) => row.path)
			.flatMap((page) => [...pageText(page).matchAll(/\]\(([^)\s]+\.(?:png|jpe?g|gif|svg|webp))\)/g)])
			.map((match) => match[1] ?? "")
			.filter((target) => !target.startsWith("http"))
			.filter((target) => !existsSync(join(docs, target.replace(/^\.?\//, ""))))
			.map((target) => `${target} is not under docs/`);
		expect(missing).toEqual([]);
	});
});

describe("the URLs the site emits", () => {
	/** A root-absolute `href` or `src` in HTML, or a root-absolute link or image in Markdown. */
	const ROOT_ABSOLUTE = /(?:href|src)="\/(?!\/)[^"]*"|\]\(\/(?!\/)/;

	test("all go through relative_url, so the baseurl is applied", () => {
		// The layout and includes are HTML, the content is Markdown; both are scanned
		// because a link written once in an include breaks every page.
		const files = walkFiles(docs).filter((file) => file.endsWith(".html") || file.endsWith(".md"));
		const offenders = files
			.map((file) => ({ file, text: readFileSync(file, "utf-8") }))
			.filter(({ text }) => ROOT_ABSOLUTE.test(text))
			.map(({ file }) => relative(root, file));
		expect(offenders).toEqual([]);
	});
});
