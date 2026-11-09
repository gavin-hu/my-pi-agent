/**
 * The site's copies: `bun run sync:docs` against a fixture tree.
 *
 * The command's promise is the set, not the copying: every image a page names is there
 * and byte-identical to its source, and no file is there that no page names. The fixture
 * is a two-file repository — one page and one screenshot — so a failure names the rule it
 * broke rather than a directory of real screenshots.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { formatReport, siteImages, syncDocsAssets } from "./docs-assets.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A repository with one page naming one screenshot, and nothing copied yet. */
function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "docs-assets-"));
	roots.push(root);
	mkdirSync(join(root, "assets", "screens"), { recursive: true });
	mkdirSync(join(root, "docs", "extensions"), { recursive: true });
	writeFileSync(join(root, "assets", "screens", "board.png"), "first frame");
	writeFileSync(
		join(root, "docs", "extensions", "board.md"),
		'# board\n\n<img src="../../assets/screens/board.png" alt="the board">\n',
	);
	return root;
}

/** The site's copy of the fixture's one screenshot. */
const copyOf = (root: string): string => join(root, "docs", "assets", "screens", "board.png");

describe("siteImages", () => {
	test("reads a page's image through its URL, not its file", () => {
		// `../../` climbs out of `/extensions/board/` on the site; the same path from
		// `docs/extensions/board.md` would climb out of the site instead.
		const root = fixture();
		expect(siteImages(join(root, "docs"))).toEqual([{ path: "assets/screens/board.png", page: "extensions/board.md" }]);
	});

	test("ignores a remote, a data URL, and a page that is not there", () => {
		const root = fixture();
		writeFileSync(
			join(root, "docs", "index.md"),
			"![a](https://example.com/x.png) ![b](data:image/png;base64,xx) ![c](../../../outside.png)\n",
		);
		expect(siteImages(join(root, "docs")).map((reference) => reference.path)).toEqual(["assets/screens/board.png"]);
	});
});

describe("syncDocsAssets", () => {
	test("copies a missing image with the directory it needs", () => {
		const root = fixture();
		const report = syncDocsAssets({ root });
		expect(report).toEqual({
			referenced: 1,
			copied: ["assets/screens/board.png"],
			unchanged: [],
			owned: [],
			removed: [],
		});
		expect(readFileSync(copyOf(root), "utf8")).toBe("first frame");
	});

	test("refreshes a stale copy and leaves an identical one alone", () => {
		const root = fixture();
		syncDocsAssets({ root });
		expect(syncDocsAssets({ root }).unchanged).toEqual(["assets/screens/board.png"]);
		writeFileSync(join(root, "assets", "screens", "board.png"), "second frame");
		expect(syncDocsAssets({ root }).copied).toEqual(["assets/screens/board.png"]);
		expect(readFileSync(copyOf(root), "utf8")).toBe("second frame");
	});

	test("keeps a referenced image whose source is the site's own", () => {
		// The chrome.webp derivative: a referenced file with no `assets/` source.
		const root = fixture();
		mkdirSync(join(root, "docs", "assets", "screens"), { recursive: true });
		writeFileSync(join(root, "docs", "index.md"), '<img src="./assets/screens/hero.webp">\n');
		writeFileSync(join(root, "docs", "assets", "screens", "hero.webp"), "lighter frame");
		const report = syncDocsAssets({ root });
		expect(report.owned).toEqual(["assets/screens/hero.webp"]);
		expect(readFileSync(join(root, "docs", "assets", "screens", "hero.webp"), "utf8")).toBe("lighter frame");
	});

	test("removes a copy no page names, and the directory it emptied", () => {
		const root = fixture();
		syncDocsAssets({ root });
		mkdirSync(join(root, "docs", "assets", "tools"), { recursive: true });
		writeFileSync(join(root, "docs", "assets", "tools", "goal.png"), "nobody names this");
		const report = syncDocsAssets({ root });
		expect(report.removed).toEqual(["assets/tools/goal.png"]);
		expect(existsSync(join(root, "docs", "assets", "tools"))).toBe(false);
		expect(readdirSync(join(root, "docs", "assets"))).toEqual(["screens"]);
	});

	test("keeps the one image the shell serves and no page names", () => {
		const root = fixture();
		mkdirSync(join(root, "docs", "assets"), { recursive: true });
		writeFileSync(join(root, "docs", "assets", "favicon.svg"), "<svg/>");
		expect(syncDocsAssets({ root }).removed).toEqual([]);
		expect(existsSync(join(root, "docs", "assets", "favicon.svg"))).toBe(true);
	});

	test("refuses to remove anything when no page names an image", () => {
		// The one failure that would otherwise empty the site's assets: a resolver that
		// read no page. It throws, and the copy stays where it was.
		const root = fixture();
		syncDocsAssets({ root });
		writeFileSync(join(root, "docs", "extensions", "board.md"), "# board\n");
		expect(() => syncDocsAssets({ root })).toThrow("refusing to remove anything");
		expect(existsSync(copyOf(root))).toBe(true);
	});

	test("writes nothing on a dry run", () => {
		const root = fixture();
		mkdirSync(join(root, "docs", "assets", "tools"), { recursive: true });
		writeFileSync(join(root, "docs", "assets", "tools", "goal.png"), "unreferenced");
		const report = syncDocsAssets({ root, dryRun: true });
		expect(report.copied).toEqual(["assets/screens/board.png"]);
		expect(report.removed).toEqual(["assets/tools/goal.png"]);
		expect(existsSync(copyOf(root))).toBe(false);
		expect(existsSync(join(root, "docs", "assets", "tools", "goal.png"))).toBe(true);
	});
});

describe("the report", () => {
	test("names every file it touched, and counts them under it", () => {
		const lines = formatReport(
			{
				referenced: 3,
				copied: ["assets/screens/a.png"],
				unchanged: ["assets/screens/b.png"],
				owned: ["assets/screens/hero.webp"],
				removed: ["assets/tools/c.png"],
			},
			true,
		);
		expect(lines).toContain("copied    assets/screens/a.png");
		expect(lines).toContain("site-owned assets/screens/hero.webp");
		expect(lines).toContain("3 referenced · 1 copied · 1 unchanged · 1 site-owned · 1 removed");
		expect(lines.at(-1)).toBe("dry run: nothing written");
	});
});
