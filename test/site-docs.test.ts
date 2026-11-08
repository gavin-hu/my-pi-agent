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

/**
 * A URL the page asks for, as a path under `docs/`, resolved the way the browser
 * does: from the page's own URL, which `permalink: pretty` puts at the page's
 * directory.
 */
function resolveFrom(pagePath: string, target: string): string {
	const stem = pagePath.replace(/\.(?:md|html)$/, "");
	const directory = stem === "index" ? [] : stem.split("/").slice(0, -1);
	const stack = [...directory];
	for (const part of target.split("#")[0].split("?")[0].split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") stack.pop();
		else stack.push(part);
	}
	return stack.join("/");
}

/**
 * A PNG's or WebP's pixel size, read from its header. Enough for the one
 * derivative the site serves; a format that appears later returns `undefined`
 * and fails the case rather than passing silently.
 */
function imageSize(file: string): { width: number; height: number } | undefined {
	const bytes = readFileSync(file);
	if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
	}
	if (bytes.subarray(0, 4).toString("ascii") !== "RIFF") return undefined;
	const chunk = bytes.subarray(12, 16).toString("ascii");
	if (chunk === "VP8X") {
		return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
	}
	if (chunk === "VP8L") {
		const bits = bytes.readUInt32LE(21);
		return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
	}
	return undefined;
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

	test("keeps every unlisted page out of the build", () => {
		// A page the sidebar does not list is still served at its own URL and crawls
		// like any other, so the contributor guides stay out of the build until the
		// content rewrite replaces them.
		// The key runs to the end of the file or to the next top-level key.
		const lines = config.split("\n");
		const start = lines.findIndex((line) => line.startsWith("exclude:"));
		const block: string[] = [];
		for (const line of lines.slice(start + 1)) {
			if (/^\S/.test(line)) break;
			block.push(line);
		}
		const excluded = new Set(
			block
				.map((line) => /^\s+-\s+(.+)$/.exec(line)?.[1]?.trim())
				.filter((entry): entry is string => entry !== undefined),
		);
		const unbuilt = [...UNLISTED].filter((page) => !excluded.has(page));
		const strayed = [...excluded].filter((entry) => entry.endsWith(".md")).filter((entry) => !UNLISTED.has(entry));
		expect({ unbuilt, strayed }).toEqual({ unbuilt: [], strayed: [] });
	});

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
	/**
	 * Pictures the site serves in a lighter form than the one the capture scripts
	 * write: a recapture leaves the derivative stale, so its shape is checked
	 * against the source rather than its bytes.
	 */
	const DERIVATIVES: ReadonlyArray<[derivative: string, source: string]> = [
		["assets/screens/chrome.webp", "assets/screens/chrome.png"],
	];

	test("are byte-identical to the assets the capture scripts write", () => {
		const copies = walkFiles(join(docs, "assets")).filter((file) => /\.(png|jpe?g|gif|svg|webp)$/.test(file));
		const stale = copies
			.map((copy) => ({ copy, source: join(root, relative(docs, copy)) }))
			.filter(({ source }) => existsSync(source))
			.filter(({ copy, source }) => !readFileSync(copy).equals(readFileSync(source)))
			.map(({ copy, source }) => `${relative(docs, copy)} differs from ${relative(root, source)}; copy it again`);
		expect(stale).toEqual([]);
	});

	test("keep a lighter form in the source's shape, and no bigger", () => {
		const problems = DERIVATIVES.flatMap(([derivative, source]) => {
			const copy = join(docs, derivative);
			const original = join(root, source);
			if (!existsSync(copy) || !existsSync(original)) return [`${derivative}: the copy or ${source} is missing`];
			const lighter = imageSize(copy);
			const full = imageSize(original);
			if (lighter === undefined || full === undefined) return [`${derivative}: no readable size`];
			const problems: string[] = [];
			if (readFileSync(copy).byteLength >= readFileSync(original).byteLength) {
				problems.push(`${derivative} is not lighter than ${source}`);
			}
			const ratio = (size: { width: number; height: number }): number => size.width / size.height;
			if (Math.abs(ratio(lighter) - ratio(full)) > 0.01) {
				problems.push(
					`${derivative} is ${lighter.width}×${lighter.height} against ${source}'s ${full.width}×${full.height}; recopy it`,
				);
			}
			return problems;
		});
		expect(problems).toEqual([]);
	});

	test("are reachable from the page at the URL the site serves", () => {
		// A page's images are written for GitHub, where `../../assets/` climbs from
		// `docs/extensions/` to the repository root. The site serves that page at
		// `/extensions/<name>/`, so the same path climbs from the site root instead —
		// which is `docs/`, and the file has to be copied there for the picture to
		// appear. Resolving it the way the browser does is the only check that sees it.
		const missing = nav.pages.flatMap((row) => {
			const targets = [...pageText(row.path).matchAll(/\]\(([^)\s]+)\)|src="([^"]+)"/g)].map(
				(match) => match[1] ?? match[2] ?? "",
			);
			return targets
				.filter((target) => target !== "" && !/^(?:https?:|mailto:|#|\/\/)/.test(target))
				.filter((target) => !target.startsWith("/") && target.includes("."))
				.map((target) => ({ page: row.path, target, resolved: resolveFrom(row.path, target) }))
				.filter((entry) => /\.(?:png|jpe?g|gif|svg|webp)$/.test(entry.resolved))
				.filter((entry) => !existsSync(join(docs, entry.resolved)))
				.map((entry) => `${entry.page}: ${entry.target} is not in docs/${entry.resolved}`);
		});
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
