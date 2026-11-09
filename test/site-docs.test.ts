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
 * cases hold the half a test can see — the data, the paths, the assets, and the
 * links that resolve on GitHub and 404 once the site builds them.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import { SHELL_IMAGES, siteImages } from "../scripts/docs-assets.ts";
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
 * A target walked down a page's parts, refusing a `..` that has nothing left to
 * climb: the site's root is `docs/`, and the host's root serves none of it.
 */
function resolveIn(base: string[], target: string): { path: string; escaped: boolean } {
	const stack = [...base];
	for (const part of target.split("#")[0].split("?")[0].split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (stack.length === 0) return { path: "", escaped: true };
			stack.pop();
			continue;
		}
		stack.push(part);
	}
	return { path: stack.join("/"), escaped: false };
}

/**
 * The directory the browser resolves a target against: the page's URL, which
 * `permalink: pretty` gives as the page's own name. The extensions index is
 * `extensions/` rather than `extensions/README/`, because `_config.yml` gives it
 * that permalink.
 */
function urlBase(path: string): string[] {
	const stem = path.replace(/\.(?:md|html)$/, "").replace(/(^|\/)README$/, "");
	return stem === "" || stem === "index" ? [] : stem.split("/");
}

/**
 * The directory the plugin resolves a `.md` target against: the page's own file,
 * not its URL. The two differ for a page at the root, where the file's directory
 * is `docs/` and the URL's is `/<name>/`.
 */
function fileBase(path: string): string[] {
	const stem = path.replace(/\.(?:md|html)$/, "");
	return stem === "index" ? [] : stem.split("/").slice(0, -1);
}

/** Whether the site serves a page or a file at a resolved URL path. */
function served(path: string): boolean {
	if (path === "") return existsSync(join(docs, "index.md"));
	const file = join(docs, path);
	// A directory alone is not a page: Pages emits one only for a file, or for the
	// `index.md` or `README.md` inside it.
	if (existsSync(file) && statSync(file).isFile()) return true;
	if (existsSync(`${file}.md`)) return true;
	return ["index.md", "README.md"].some((index) => existsSync(join(file, index)));
}

/** A target the browser resolves itself: absolute, a fragment, or the site root. */
function isRelative(target: string): boolean {
	return !/^(?:https?:|mailto:|#|\/)/.test(target) && !target.includes("{{");
}

/** Every link or image a page asks for, in Markdown and in HTML. */
function pageTargets(path: string): string[] {
	const text = readFileSync(join(docs, path), "utf-8");
	return [...text.matchAll(/\]\(([^)\s]+)\)|(?:href|src)="([^"]+)"/g)].map((match) => match[1] ?? match[2] ?? "");
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
		const missing = sitePages().filter((page) => !listed.includes(page));
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

/** One catalog section: its heading, and the extension pages its rows link. */
interface CatalogSection {
	heading: string;
	extensions: string[];
}

/**
 * The entry README's promise sections, in order, with the extensions each one lists.
 *
 * The catalog is what a reader picks from, so it is the order the sidebar, the
 * extension index, and this file all mean by "the catalog's order". A section that
 * links no extension page — Skills, Themes — is dropped, which is what makes a
 * renamed promise heading fail the count below instead of passing as empty.
 */
function catalogSections(): CatalogSection[] {
	const lines = readFileSync(join(root, "README.md"), "utf-8").split("\n");
	const start = lines.findIndex((line) => line.trim() === "## What you get");
	const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
	const sections: CatalogSection[] = [];
	for (const line of lines.slice(start, end < 0 ? undefined : end)) {
		const heading = /^###\s+(.+?)\s*$/.exec(line)?.[1];
		if (heading !== undefined && heading !== null) {
			sections.push({ heading, extensions: [] });
			continue;
		}
		const name = /^\|\s*\[`[^`]+`\]\(\.\/docs\/extensions\/([^)/]+)\.md\)/.exec(line)?.[1];
		if (name !== undefined && name !== null) sections.at(-1)?.extensions.push(name);
	}
	return sections.filter((section) => section.extensions.length > 0);
}

/** The extension pages the sidebar lists, in nav order, with the group each sits under. */
function navExtensionRows(): Array<{ name: string; group: string }> {
	return nav.pages
		.filter((row) => /^extensions\/[^/]+\.md$/.test(row.path) && row.path !== "extensions/README.md")
		.map((row) => ({ name: row.path.slice("extensions/".length, -".md".length), group: row.group }));
}

describe("the navigation's extension list", () => {
	const catalog = catalogSections();
	const names = catalog.flatMap((section) => section.extensions);

	test("finds the catalog, so a renamed section fails here rather than comparing nothing", () => {
		expect(catalog.length, "no promise section in README.md lists an extension page").toBeGreaterThan(1);
		expect(names.length, "README.md and the sidebar disagree on how many extensions there are").toBe(
			navExtensionRows().length,
		);
	});

	test("orders and groups the extension pages the way the catalog does", () => {
		// Order and grouping in one comparison: a sidebar re-sorted, or a page filed under
		// another promise, names itself in the failure. Adding an extension means adding its
		// README row first — that row is what this reads.
		const wanted = catalog.flatMap((section) => section.extensions.map((name) => ({ name, group: section.heading })));
		expect(navExtensionRows(), "docs/_data/docs.json: catalog order or group drifted").toEqual(wanted);
	});

	test("holds the extension index to the same order", () => {
		// The index repeats the list so a reader who lands on it gets the reading order;
		// its own sentence calls that "the order the catalog lists them".
		const listed = [...pageText("extensions/README.md").matchAll(/^-\s+\[`[^`]+`\]\(\.\/([^)/]+)\.md\)/gm)].map(
			(match) => match[1],
		);
		expect(listed, "docs/extensions/README.md: out of catalog order").toEqual(names);
	});
});

describe("the tutorials index", () => {
	/** Every walkthrough, from the tree: the tutorials minus the index that lists them. */
	const tutorials = sitePages().filter((page) => page.startsWith("tutorials/") && page !== "tutorials/README.md");

	test("lists every walkthrough, and names none that is not one", () => {
		// The index is where a reader who does not yet know the names starts, so a
		// twelfth walkthrough that only reaches the sidebar is a page nobody meets in
		// order. Split in two so the failure says which way it drifted.
		const listed = [...pageText("tutorials/README.md").matchAll(/\]\(\.\/(first-[\w-]+\.md)\)/g)].map(
			(match) => `tutorials/${match[1]}`,
		);
		expect({
			missing: tutorials.filter((page) => !listed.includes(page)),
			extra: listed.filter((page) => !tutorials.includes(page)),
		}).toEqual({ missing: [], extra: [] });
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

/**
 * The meta a page declares about itself: what a search result reads, and what a share of
 * the link looks like once it is pasted into a chat.
 *
 * The Liquid is reviewed rather than run, so what is held here is the facts the templates
 * promise — which files exist, what they loop, which size they claim — and the rendered
 * HTML is left to that review, the same bargain as the build cases above.
 */
describe("the meta the site emits", () => {
	/** The one include every page wears: a tag is written once, here, not per page. */
	const head = pageText("_includes/head.html");

	/** A `<meta>` tag's content, by the `property` or `name` that names it. */
	function meta(key: string): string {
		return new RegExp(`<meta (?:property|name)="${key}" content="([\\s\\S]*?)">`).exec(head)?.[1] ?? "";
	}

	/** The site file `og:image` names, as a path under `docs/`. */
	function shareImage(): string {
		return /<meta property="og:image" content="\{\{ '\/([^']+)' \| absolute_url \}\}">/.exec(head)?.[1] ?? "";
	}

	test("shares the screenshot as a raster image, at the size the file reports", () => {
		// An unfurler older than WebP renders nothing for the page's own lighter copy, and the
		// width and height are what the card reserves before the image arrives: a recapture that
		// changes the frame has to move them in the same commit.
		const image = shareImage();
		const file = join(docs, image);
		expect(image, "head.html: og:image names no site asset").toMatch(/\.(?:png|jpe?g)$/);
		expect(existsSync(file), `head.html: og:image names ${image}, which is not under docs/`).toBe(true);
		const size = imageSize(file);
		expect(size, `${image}: no readable pixel size`).toBeDefined();
		expect(
			{ width: meta("og:image:width"), height: meta("og:image:height"), type: meta("og:image:type") },
			`head.html: the declared og:image size is not ${image}'s`,
		).toEqual({
			width: String(size?.width),
			height: String(size?.height),
			type: image.endsWith(".png") ? "image/png" : "image/jpeg",
		});
		// The card and the preview are one picture, so a re-point moves both or neither.
		expect(meta("twitter:image"), "head.html: twitter:image disagrees with og:image").toContain(`'/${image}'`);
		// Alt text describes the frame; the page's summary is already on the description tags.
		expect(head, "head.html: the share image carries no alt text").toMatch(/assign share_alt = "[^"]{20,}"/);
	});

	test("calls the home page a website, and every other page an article", () => {
		// One document is the site and the rest are pages on it, which is the distinction an
		// unfurler lays its card out by.
		const type = meta("og:type");
		expect(type, "head.html: og:type names no page kind").toContain("website");
		expect(type, "head.html: og:type names no second page kind").toContain("article");
		expect(type, "head.html: og:type does not branch on the home page").toContain('page.path == "index.md"');
	});

	test("keeps the not-found page out of the canonical", () => {
		// Pages serves this document under whichever path was mistyped, so a canonical would
		// name a page nobody asked for — and two of them would tell a crawler nothing at all.
		const guarded =
			/\{%-?\s*unless page\.path == "404\.html"\s*-?%\}([\s\S]*?)\{%-?\s*endunless\s*-?%\}/.exec(head)?.[1] ?? "";
		expect(guarded, "head.html: the canonical is not guarded against the not-found page").toContain('rel="canonical"');
		expect(head.match(/rel="canonical"/g)?.length, "head.html: more than one canonical").toBe(1);
	});

	test("titles the home page from a tagline that fits, and keeps the description as the fallback", () => {
		// The description is a sentence for a snippet; the title is a line the brand shares with
		// it, and a search result cuts around 60 columns.
		const config = readFileSync(join(docs, "_config.yml"), "utf-8");
		const tagline = /^tagline:\s*(\S.*)$/m.exec(config)?.[1].trim() ?? "";
		expect(tagline, "_config.yml: no tagline for the home title").not.toBe("");
		expect(
			`my-pi-agent — ${tagline}`.length,
			"_config.yml: the home title is longer than a search result shows",
		).toBeLessThanOrEqual(60);
		expect(head, "head.html: the home title appends the description, not the tagline").toContain(
			"append: site.tagline",
		);
		expect(/^description:\s*\S/m.test(config), "_config.yml: the unlisted-page fallback went missing").toBe(true);
	});

	test("ships a sitemap over the navigation table, and lists nothing the sidebar does not", () => {
		// Built from `_data/docs.json` rather than walked, so a page added to the table is in the
		// sitemap and a page the table drops leaves it; `site.pages` supplies the URL, as
		// `search.json` does, because `permalink: pretty` makes it something other than the file
		// name. One `<url>` in the template means the loop is the only source of one.
		const sitemap = pageText("sitemap.xml");
		expect(sitemap.startsWith("---\nlayout: null\npermalink: /sitemap.xml\n---\n<?xml")).toBe(true);
		expect(sitemap, "sitemap.xml: not built from the navigation table").toContain("for doc in site.data.docs.pages");
		expect(sitemap, "sitemap.xml: does not resolve the row's URL").toContain('site.pages | where: "path", doc.path');
		expect(sitemap).toContain("{{ found.url | absolute_url }}");
		expect(sitemap.match(/<url>/g)?.length, "sitemap.xml: a URL outside the navigation loop").toBe(1);
	});

	test("points robots.txt at the sitemap, absolutely", () => {
		// The protocol has no base to resolve a relative path against, and the site lives under a
		// baseurl, so `absolute_url` is the only form that reaches the file.
		const robots = pageText("robots.txt");
		expect(robots.startsWith("---\nlayout: null\npermalink: /robots.txt\n---\n")).toBe(true);
		expect(robots).toContain("User-agent: *");
		expect(robots, "robots.txt: the sitemap is not named absolutely").toContain(
			"Sitemap: {{ '/sitemap.xml' | absolute_url }}",
		);
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
			.map(
				({ copy, source }) =>
					`${relative(docs, copy)} differs from ${relative(root, source)}; run \`bun run sync:docs\``,
			);
		expect(stale).toEqual([]);
	});

	test("serve only the images a page names", () => {
		// The set is the pages' references, not a copy of everything captured: a file here
		// that no page names is weight the repository carries for no reader.
		const named = new Set(siteImages(docs).map((reference) => reference.path));
		const unserved = walkFiles(join(docs, "assets"))
			.filter((file) => /\.(png|jpe?g|gif|svg|webp)$/.test(file))
			.map((file) => relative(docs, file))
			.filter((path) => !named.has(path) && !SHELL_IMAGES.includes(path))
			.map((path) => `docs/${path}: no page names it; run \`bun run sync:docs\` to remove it`);
		expect(unserved).toEqual([]);
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
				.map((target) => ({ page: row.path, target, resolved: resolveIn(urlBase(row.path), target) }))
				.filter((entry) => /\.(?:png|jpe?g|gif|svg|webp)$/.test(entry.resolved.path))
				.filter((entry) => entry.resolved.escaped || !existsSync(join(docs, entry.resolved.path)))
				.map((entry) => `${entry.page}: ${entry.target} is not in docs/${entry.resolved.path}`);
		});
		expect(missing).toEqual([]);
	});
});

describe("the URLs the site emits", () => {
	/** A root-absolute `href` or `src` in HTML, or a root-absolute link or image in Markdown. */
	const ROOT_ABSOLUTE = /(?:href|src)="\/(?!\/)[^"]*"|\]\(\/(?!\/)/;

	/** A Markdown link whose label runs over a line break. */
	const WRAPPED_LABEL = /\[[^\]]*\n[^\]]*\]\(([^)\s]+)\)/g;

	/** A reference-style definition, whose target the plugin never rewrites. */
	const LINK_DEFINITION = /^\[[^\]\n]+\]:\s*(\S+)/gm;

	/** The pages the navigation lists. The not-found page is not one of them: Pages
	 * serves it at whatever URL a reader mistyped, so nothing relative on it can
	 * resolve to the same place twice. */
	const listedPages = (): string[] => sitePages();

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

	test("keep every relative .md target a file under docs/, which is what the plugin rewrites", () => {
		// The plugin resolves a `.md` target from the page's own file, not from its URL.
		// A target that climbs out of `docs/` is left as written, and the site serves
		// `docs/` at `/`, so `/README.md` is a page that does not exist.
		const offenders = listedPages().flatMap((path) =>
			pageTargets(path)
				.filter((target) => isRelative(target) && target.split("#")[0].endsWith(".md"))
				.map((target) => ({ target, resolved: resolveIn(fileBase(path), target) }))
				.filter(({ resolved }) => resolved.escaped || !existsSync(join(docs, resolved.path)))
				.map(({ target }) => `${path}: ${target} has no page under docs/; link it on GitHub instead`),
		);
		expect(offenders).toEqual([]);
	});

	test("keeps a relative target off a directory, which is a source tree on GitHub", () => {
		// Each guard was right about its own half, which is how the defect survived: the
		// browser resolves `../extensions/serve/` to a page this site serves, while GitHub
		// resolves it to `extensions/serve/`, the code. Naming the page's `.md` target is
		// the one form both readers agree on — the plugin rewrites it for the site.
		//
		// The path is walked from the repository root rather than from `docs/`, because the
		// target that matters climbs out of `docs/` and `resolveIn` reports that as escaping.
		const directoryOf = (page: string, target: string): string | undefined => {
			const stack = ["docs", ...fileBase(page)];
			for (const part of target.split("#")[0].split("?")[0].split("/")) {
				if (part === "" || part === ".") continue;
				if (part === "..") {
					if (stack.length === 0) return undefined;
					stack.pop();
				} else stack.push(part);
			}
			const file = join(root, ...stack);
			return existsSync(file) && statSync(file).isDirectory() ? stack.join("/") : undefined;
		};
		const offenders = listedPages().flatMap((path) =>
			pageTargets(path)
				.filter((target) => isRelative(target) && !target.split("#")[0].endsWith(".md"))
				.map((target) => ({ target, directory: directoryOf(path, target) }))
				.filter(({ directory }) => directory !== undefined)
				.map(
					({ target, directory }) =>
						`${path}: ${target} is the directory ${directory}/; name the page's .md target, or an absolute GitHub URL for the code`,
				),
		);
		expect(offenders).toEqual([]);
	});

	test("resolve every other relative target to a page or file the site serves", () => {
		// A URL-shaped target is the browser's to resolve, from the page's URL: a page
		// at `/security/` climbing `../extensions/plan/` is right, one at
		// `/configuration/` climbing `./extensions/` is not, and one climbing past the
		// site's own root lands on the host, which serves none of it.
		const offenders = listedPages().flatMap((path) =>
			pageTargets(path)
				.filter((target) => isRelative(target) && !target.split("#")[0].endsWith(".md"))
				.map((target) => ({ target, resolved: resolveIn(urlBase(path), target) }))
				.filter(({ resolved }) => resolved.escaped || !served(resolved.path))
				.map(({ target, resolved }) =>
					resolved.escaped
						? `${path}: ${target} climbs past the site's root`
						: `${path}: ${target} resolves to /${resolved.path}, which the site does not serve`,
				),
		);
		expect(offenders).toEqual([]);
	});

	test("keeps a link definition off a relative .md target, which the plugin never rewrites", () => {
		// Only inline `[label](target)` links are rewritten, so a definition would ship
		// the source path and the browser would ask for a page that does not exist.
		const offenders = [...sitePages(), "404.html"].flatMap((path) =>
			[...readFileSync(join(docs, path), "utf-8").matchAll(LINK_DEFINITION)]
				.map((match) => match[1])
				.filter((target) => isRelative(target) && target.split("#")[0].endsWith(".md"))
				.map((target) => `${path}: the definition of ${target} ships as written; write the link inline`),
		);
		expect(offenders).toEqual([]);
	});

	test("keeps the not-found page free of relative links, because it answers under any URL", () => {
		// Pages serves this document for a mistyped path, and the browser resolves its
		// URLs against the path that was asked for, so only a root-absolute link works.
		const offenders = pageTargets("404.html")
			.filter((target) => isRelative(target) && !target.split("#")[0].endsWith(".md"))
			.map((target) => `404.html: ${target} resolves against whatever URL was asked for`);
		expect(offenders).toEqual([]);
	});

	test("keep a link's label on one line, or relative-links ships the raw .md path", () => {
		// The plugin rewrites a relative `.md` target to the page's URL by matching the
		// link on one line; a label that wraps leaves the target untouched, so the
		// browser asks for `/extensions/tutorials/first-board.md` and gets a 404. The
		// not-found page is scanned too: the plugin rewrites it at build time.
		const offenders = [...sitePages(), "404.html"].flatMap((path) =>
			[...readFileSync(join(docs, path), "utf-8").matchAll(WRAPPED_LABEL)]
				.map((match) => match[1])
				.filter(isRelative)
				.map((target) => `${path}: the label above ${target} spans a line break; keep it on one line`),
		);
		expect(offenders).toEqual([]);
	});
});
