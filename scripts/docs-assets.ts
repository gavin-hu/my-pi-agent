/**
 * `bun run sync:docs`: make the site's copies match the pages that serve them.
 *
 * The site is served from `docs/`, so a page written for GitHub —
 * `../../assets/screens/board.png` in `docs/extensions/board.md` — lands on
 * `docs/assets/screens/board.png` once Pages serves that page at
 * `/extensions/board/`. The copy is therefore required, and no command performed it: a
 * recapture left the site on the old frame until someone remembered to copy it again.
 *
 * So the set is read from the pages, never typed here: an image a page references is
 * copied from the repository's own `assets/`, and a file under `docs/assets/` that no page
 * references is removed. A reference with no source is the site's own asset — the
 * `chrome.webp` derivative — and is left alone.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");

/**
 * The one image the site serves that no page names: `_includes/head.html` links it as
 * `/assets/favicon.svg`, and the layout is not a page this scan reads.
 */
export const SHELL_IMAGES: readonly string[] = ["assets/favicon.svg"];
const IMAGE = /\.(?:png|jpe?g|gif|svg|webp)$/i;

/** A link target, an `src`, or a CSS `url()` — the three ways a page names an image. */
const TARGET = /\]\(([^)\s]+)\)|src="([^"]+)"|url\((["']?)([^)\s"']+)\3\)/g;

/** An image a page names, as its path under the site root, and the page that names it. */
export interface Reference {
	/** For example `assets/screens/board.png`, resolved from the page's URL. */
	path: string;
	/** The page that names it, relative to the site root. */
	page: string;
}

/** What one run did, in the order the report prints it. */
export interface SyncReport {
	/** At or above the site's root, so a page can name its own asset. */
	referenced: number;
	/** Copied from `assets/` because the copy was missing or stale. */
	copied: string[];
	/** Already byte-identical to its source. */
	unchanged: string[];
	/** Referenced with no source under `assets/`: the site owns the file. */
	owned: string[];
	/** Under `docs/assets/` with no page naming it. */
	removed: string[];
}

/** Every page the site writes: Markdown and HTML outside the build's `_` directories. */
function sitePages(siteDir: string): string[] {
	const pages: string[] = [];
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			if (name.startsWith(".")) continue;
			const path = join(dir, name);
			if (statSync(path).isDirectory()) {
				if (!name.startsWith("_")) walk(path);
				continue;
			}
			if (/\.(?:md|html)$/.test(name)) pages.push(relative(siteDir, path).replaceAll("\\", "/"));
		}
	};
	walk(siteDir);
	return pages.sort();
}

/**
 * The directory the browser resolves a target against: the page's URL, which
 * `permalink: pretty` makes its own name. `index.md` and `README.md` keep their
 * directory, because `_config.yml` gives those the directory's own URL.
 */
function urlDir(page: string): string[] {
	const stem = page.replace(/\.(?:md|html)$/, "").replace(/(^|\/)README$/, "");
	return stem === "" || stem === "index" ? [] : stem.split("/");
}

/**
 * A target walked down a page's URL, refusing a `..` with nothing left to climb: the
 * site's root is the site directory, and the host's root serves none of it.
 */
function resolveIn(base: readonly string[], target: string): string | undefined {
	const stack = [...base];
	for (const part of target.split("#")[0].split("?")[0].split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (stack.length === 0) return undefined;
			stack.pop();
			continue;
		}
		stack.push(part);
	}
	return stack.join("/");
}

/** Every image the site's written pages reference, in page order. */
export function siteImages(siteDir: string): Reference[] {
	const references: Reference[] = [];
	const seen = new Set<string>();
	for (const page of sitePages(siteDir)) {
		const text = readFileSync(join(siteDir, page), "utf8");
		for (const match of text.matchAll(TARGET)) {
			const raw = match[1] ?? match[2] ?? match[4] ?? "";
			if (/^(?:https?:|mailto:|#|\/\/|data:|\{\{)/.test(raw)) continue;
			const target = raw.split("#")[0].split("?")[0];
			if (!IMAGE.test(target)) continue;
			const path = resolveIn(urlDir(page), target);
			if (path === undefined || seen.has(path)) continue;
			seen.add(path);
			references.push({ path, page });
		}
	}
	return references;
}

/** Every image file the site serves, relative to its root. */
function siteAssets(siteDir: string): string[] {
	const assets = join(siteDir, "assets");
	if (!existsSync(assets)) return [];
	const files: string[] = [];
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (IMAGE.test(name)) files.push(relative(siteDir, path).replaceAll("\\", "/"));
		}
	};
	walk(assets);
	return files.sort();
}

/** Remove the directories a removal emptied, leaving the site's `assets/` itself. */
function pruneEmptyDirs(dir: string): void {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (!statSync(path).isDirectory()) continue;
		pruneEmptyDirs(path);
		if (readdirSync(path).length === 0) rmSync(path, { recursive: true });
	}
}

/**
 * Copy what the pages reference and remove what none does.
 *
 * A scan that found nothing removes nothing and throws: the resolver reading no page is
 * the one failure that would otherwise empty the site's assets, so it fails loudly.
 */
export function syncDocsAssets(options: { root?: string; siteDir?: string; dryRun?: boolean } = {}): SyncReport {
	const root = options.root ?? REPO;
	const siteDir = options.siteDir ?? join(root, "docs");
	const references = siteImages(siteDir);
	if (references.length === 0) {
		throw new Error(`${relative(root, siteDir) || "."}: no page names an image; refusing to remove anything`);
	}

	const report: SyncReport = { referenced: references.length, copied: [], unchanged: [], owned: [], removed: [] };
	for (const reference of references) {
		const source = join(root, reference.path);
		const copy = join(siteDir, reference.path);
		if (!existsSync(source)) {
			report.owned.push(reference.path);
			continue;
		}
		if (existsSync(copy) && readFileSync(copy).equals(readFileSync(source))) {
			report.unchanged.push(reference.path);
			continue;
		}
		if (options.dryRun !== true) {
			mkdirSync(dirname(copy), { recursive: true });
			copyFileSync(source, copy);
		}
		report.copied.push(reference.path);
	}

	const referenced = new Set(references.map((reference) => reference.path));
	for (const path of siteAssets(siteDir)) {
		if (referenced.has(path) || SHELL_IMAGES.includes(path)) continue;
		if (options.dryRun !== true) rmSync(join(siteDir, path));
		report.removed.push(path);
	}
	if (options.dryRun !== true) pruneEmptyDirs(join(siteDir, "assets"));
	return report;
}

/** The table a run prints, one row per file, and the count line under it. */
export function formatReport(report: SyncReport, dryRun: boolean): string[] {
	const row = (verb: string, path: string): string => `${verb.padEnd(9)} ${path}`;
	const lines = [
		...report.copied.map((path) => row("copied", path)),
		...report.unchanged.map((path) => row("unchanged", path)),
		...report.owned.map((path) => row("site-owned", path)),
		...report.removed.map((path) => row("removed", path)),
	];
	const counts = [
		`${report.referenced} referenced`,
		`${report.copied.length} copied`,
		`${report.unchanged.length} unchanged`,
		`${report.owned.length} site-owned`,
		`${report.removed.length} removed`,
	];
	lines.push("", counts.join(" · "));
	if (dryRun) lines.push("dry run: nothing written");
	return lines;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const unknown = args.filter((arg) => arg !== "--dry-run");
	if (unknown.length > 0) {
		console.error(`unknown option ${unknown[0]}; the only flag is --dry-run`);
		process.exit(1);
	}
	const dryRun = args.includes("--dry-run");
	const report = syncDocsAssets({ dryRun });
	for (const line of formatReport(report, dryRun)) console.log(line);
}
