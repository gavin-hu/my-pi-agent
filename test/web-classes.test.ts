/**
 * The class half of the kit's contract, read across every served page.
 *
 * The kit's own suite holds the inward answer — it names no class it no longer removes or ships. This
 * is the outward one: a page writes kit classes as strings no type checker sees (markup, a template
 * literal, a client bundle spliced into the document), so a kit rename leaves the old word behind and
 * the control draws with no rule at all while every suite stays green. `ef01313c` deleted `.bf-card`
 * and `.bf-chip` and renamed `.bf-segmented` to `.bf-tabs`; file-browse kept writing all three, and the
 * review page kept two more until its own guard caught them. One rule, one table, every page.
 *
 * A name is answered by the kit's blocks or by the page's own sheet, because a page ships both. Names
 * that are not classes are listed per page with the reason — a `localStorage` key, or a family built
 * from a table at runtime — and a family is only excepted while the sheet rules at least one of its
 * members, so deleting the whole family still reddens.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { kitNamesIn, rulesClass, sourcesUnder } from "./helpers/web-classes.ts";
import { WEB_COMPONENTS_CSS, WEB_LAYOUT_CSS } from "../lib/web/index.ts";
import { BOARD_CSS } from "../extensions/board/view/styles.ts";
import { REVIEW_CSS } from "../extensions/plan/web-page.ts";
import { BROWSE_CSS } from "../extensions/file-browse/view/styles.ts";

const root = join(import.meta.dir, "..");

/** One name a page writes that is not a class of its own, and why. */
interface Exception {
	/** The name as the page writes it; a trailing separator means a family built at runtime. */
	name: string;
	/** Why no rule is owed for it. */
	why: string;
}

/** One served page: where it writes classes, what it ships, and what is not a class. */
interface ServedPage {
	/** The extension's own name, which is also its directory under `extensions/`. */
	page: string;
	/** The directory its markup and scripts live in. */
	dir: string;
	/** The files in that directory that are not sources: the sheet itself, and any other. */
	skip: readonly string[];
	/** The stylesheet it serves, kit blocks included. */
	css: string;
	/** A source that also carries the sheet, whose CSS is removed before the read. */
	strip?: string;
	/** The names it writes that are not classes, each with the reason. */
	exceptions: readonly Exception[];
}

/**
 * The three pages the kit serves.
 *
 * `bf-tone` is a family, not a class: the board writes `"bf-tone--" + tone` from the tone table, so
 * the exact name never appears and the sheet rules the six modifiers. Resolving the suffix set here
 * would be a second copy of that table, so the exception names the family and the case below proves
 * the sheet still rules at least one member of it.
 */
const PAGES: readonly ServedPage[] = [
	{
		page: "board",
		dir: join(root, "extensions/board/view"),
		skip: ["styles.ts"],
		css: BOARD_CSS,
		exceptions: [
			{
				name: "bf-tone--",
				why: 'the board writes "bf-tone--" + tone from the tone table, so the modifier is data',
			},
		],
	},
	{
		page: "plan",
		dir: join(root, "extensions/plan"),
		skip: ["web-page.ts"],
		// The page's markup and its sheet share a file, so the sheet is read out of the text before the
		// scan: otherwise every class the sheet rules would be "written" by the page.
		css: REVIEW_CSS,
		exceptions: [
			{ name: "bf-review-draft", why: "a localStorage key the composer restores from, not a style" },
			{ name: "bf-review-name", why: "a localStorage key that remembers the reviewer's name" },
		],
	},
	{
		page: "file-browse",
		dir: join(root, "extensions/file-browse/view"),
		skip: ["styles.ts"],
		css: BROWSE_CSS,
		exceptions: [
			{
				name: "bf-diff-line--",
				why: "a family: every diff line wears a colour modifier, and the sheet rules add/del/hunk/meta/note",
			},
		],
	},
];

/** Everything a page answers for: the kit's blocks, then its own sheet. */
function shippedCss(page: ServedPage): string {
	return `${WEB_LAYOUT_CSS}${WEB_COMPONENTS_CSS}${page.css}`;
}

/** The names one page writes, with its own sheet taken out of the text when the two share a file. */
function namesOf(page: ServedPage): string[] {
	const source = sourcesUnder(page.dir, page.skip).split(page.css).join("");
	return kitNamesIn(source);
}

/** Whether an exception names a family: the interface says a trailing separator means one. */
function familyOf(exception: Exception): boolean {
	return exception.name.endsWith("--");
}

/** Whether the name is answered, exactly or as a family with at least one ruled member. */
function answered(css: string, name: string): boolean {
	if (rulesClass(css, name)) return true;
	// A family: `bf-tone--` is written with the separator already in the source, so the sheet owes it
	// one modifier at least.
	return css.includes(`.${name}--`);
}

/** The names a page writes that its sheets do not answer, and that its exceptions do not name. */
function unanswered(page: ServedPage): string[] {
	const css = shippedCss(page);
	const excepted = new Set(page.exceptions.map((entry) => entry.name));
	return namesOf(page).filter((name) => !excepted.has(name) && !answered(css, name));
}

describe("a served page's kit classes", () => {
	for (const page of PAGES) {
		test(`${page.page} writes only names its sheets rule`, () => {
			expect(unanswered(page)).toEqual([]);
		});
	}

	test("names the page and the class when one is unanswered, so a red is readable", () => {
		// The self-test: a removed family fed through the same filter, so the guard cannot pass by being
		// vacuous. `.bf-card` and `.bf-segmented` are the names ef01313c took away.
		const broken: ServedPage = {
			...(PAGES[0] as ServedPage),
			exceptions: [],
		};
		const names = kitNamesIn('<div class="bf-card bf-segmented"></div>');
		expect(names.filter((name) => !answered(shippedCss(broken), name))).toEqual(["bf-card", "bf-segmented"]);
	});

	test("keeps every exception earning its place, so the list cannot rot", () => {
		for (const page of PAGES) {
			const written = new Set(namesOf(page));
			for (const exception of page.exceptions) {
				// A family is written without its separator (`"bf-tone--" + tone` reads `bf-tone`), so the
				// evidence that it is still used is the head.
				const named = familyOf(exception) ? exception.name.slice(0, -2) : exception.name;
				expect(written.has(named), `${page.page} ${exception.name}: ${exception.why}`).toBe(true);
			}
		}
	});

	test("rules at least one member of every family it excepts", () => {
		for (const page of PAGES) {
			const css = shippedCss(page);
			for (const exception of page.exceptions) {
				if (!familyOf(exception)) continue;
				// The family must still have a member: deleting every `.bf-tone--*` rule is the red this
				// case exists for, so it is checked by the same read the guard uses.
				expect(css.includes(`.${exception.name}`), `${page.page} ${exception.name}`).toBe(true);
			}
		}
	});

	test("has a row for every extension that dresses a page in the kit", () => {
		// Discovery, not a list: an extension whose sources import the kit serves a page, so it needs a
		// row here. A fourth page cannot appear without one.
		const manifest: string[] = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).pi.extensions;
		const usesKit = manifest
			.map((entry: string) => entry.split("/")[2] ?? "")
			.filter((name: string) => name !== "")
			.filter((name: string) => {
				const dir = join(root, "extensions", name);
				return readdirSync(dir, { recursive: true })
					.filter((file) => String(file).endsWith(".ts"))
					.map((file) => readFileSync(join(dir, String(file)), "utf-8"))
					.some((text) => text.includes("lib/web/"));
			});
		expect(usesKit.sort()).toEqual(PAGES.map((page) => page.page).sort());
	});
});
