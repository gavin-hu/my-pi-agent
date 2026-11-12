/**
 * The vocabulary half of the kit's contract: the README's own sentence, held to the sheet.
 *
 * `test/web-classes.test.ts` holds a *page's* classes to the sheets it ships; this holds the kit's
 * *prose* to the sheet the kit ships, because nothing else reads `lib/web/README.md`. `ef01313c`
 * renamed four components — chip to tag, a segmented control to a tab, progress to a gauge, a card
 * to a record — and the sentence went on naming the old ones for two rounds of card work while every
 * suite stayed green. A table alone would hold the sheet to itself, so each row is also checked
 * against the sentence: a rename reddens on the row, and a sentence that drops a word reddens on the
 * same row.
 *
 * What the table covers is a *root*: a rule in the sheet whose selector is one bare class, with no
 * `__part` and no `--modifier`. Parts and modifiers are named in the sentence where they matter
 * ("buttons (`--primary`, …)") and enumerating them here would be noise nobody maintains. The shell's
 * `.bf-app*` is excluded below with its reason rather than silently; `bf-footer` needs no exclusion
 * because the sheet rules no root of that name at all — only `.bf-footer__facts`, a part of the shell's
 * footer — which is why a root-only read never sees it.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_COMPONENTS_CSS, WEB_LAYOUT_CSS } from "./index.ts";
import { rulesClass } from "../../test/helpers/web-classes.ts";

/** One component the sheet rules, and the word the vocabulary sentence names it by. */
interface Term {
	/** The root class, without its dot. */
	root: string;
	/** What the sentence calls it. Matched whole-word and case-insensitively. */
	word: string;
}

/**
 * Every root the kit's sheets rule, and the word `README.md` names it by.
 *
 * The words are the sentence's, not the class's: "empty state", "shortcut sheet", "Markdown body"
 * and "quote chip" are what a reader looks for, and deriving them from the class name would make
 * this a second copy of the sheet's spelling rather than a check on the prose.
 */
const TERMS: readonly Term[] = [
	{ root: "bf-badge", word: "badge" },
	{ root: "bf-brand", word: "brand" },
	{ root: "bf-btn", word: "buttons" },
	{ root: "bf-code", word: "code" },
	{ root: "bf-comment", word: "comment" },
	{ root: "bf-composer", word: "composer" },
	{ root: "bf-context", word: "context" },
	{ root: "bf-crumbs", word: "crumbs" },
	{ root: "bf-dialog", word: "dialog" },
	{ root: "bf-empty", word: "empty state" },
	{ root: "bf-field", word: "field" },
	{ root: "bf-gauge", word: "gauge" },
	{ root: "bf-input", word: "input" },
	{ root: "bf-kbd", word: "kbd" },
	{ root: "bf-keys", word: "shortcut sheet" },
	{ root: "bf-lane", word: "lane" },
	{ root: "bf-live", word: "live state" },
	{ root: "bf-mark", word: "mark" },
	{ root: "bf-md", word: "Markdown body" },
	{ root: "bf-media", word: "media" },
	{ root: "bf-note", word: "note" },
	{ root: "bf-panel", word: "panel" },
	{ root: "bf-quote-chip", word: "quote chip" },
	{ root: "bf-record", word: "record" },
	{ root: "bf-reload", word: "reload" },
	{ root: "bf-row", word: "row" },
	{ root: "bf-section", word: "section" },
	{ root: "bf-sort", word: "sort" },
	{ root: "bf-spacer", word: "spacer" },
	{ root: "bf-status", word: "status" },
	{ root: "bf-table", word: "table" },
	{ root: "bf-tabs", word: "tabs" },
	{ root: "bf-tag", word: "tags" },
	{ root: "bf-textarea", word: "textarea" },
	{ root: "bf-title", word: "title" },
	{ root: "bf-tree", word: "tree" },
	// `bf-wordmark` draws the glyph beside the wordmark, so the sentence's "brand and mark" is the
	// word for both: one word may stand for more than one root, never the other way round.
	{ root: "bf-wordmark", word: "mark" },
];

/** A root the table leaves out on purpose, and why the vocabulary sentence is not its reader. */
const OUT_OF_SCOPE: readonly { root: string; why: string }[] = [
	{
		root: "bf-app",
		why: "the shell's own column, drawn by layout.ts and described in its own section; the sentence lists the components a page composes",
	},
];

/** A selector that is one root class and nothing else: no `__part`, no `--modifier`. */
const ROOT = /^\.bf-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The section the sentence lives in, from `README.md`. */
const README = join(import.meta.dir, "..", "..", "lib", "web", "README.md");

/** Every root class a sheet rules, read from its text rather than from a line of it. */
function rootsIn(css: string): string[] {
	const found = new Set<string>();
	const sheet = css.replace(/\/\*[\s\S]*?\*\//g, "");
	let cursor = 0;
	while (cursor < sheet.length) {
		const open = sheet.indexOf("{", cursor);
		if (open === -1) break;
		// The selector list is everything since the last block closed; a rule that shares a line with
		// the template's opening backtick (`.bf-brand{`) would be missed by a line-anchored read.
		for (const part of sheet.slice(cursor, open).split(",")) {
			const selector = part.trim();
			if (ROOT.test(selector)) found.add(selector.slice(1));
		}
		const close = sheet.indexOf("}", open);
		cursor = close === -1 ? sheet.length : close + 1;
	}
	return [...found].sort();
}

/** The vocabulary sentence, as plain lowercase prose: the first paragraph under the kit's heading. */
function vocabularySentence(): string {
	const text = readFileSync(README, "utf-8");
	const heading = text.indexOf("## The `bf-*` kit");
	const paragraph = text.slice(heading).split("\n\n")[1] ?? "";
	return paragraph.replace(/`/g, "").toLowerCase();
}

/** Every root the sheets rule, from both sheets the kit ships. */
function kitRoots(): string[] {
	return rootsIn(`${WEB_LAYOUT_CSS}${WEB_COMPONENTS_CSS}`);
}

/** Whether the sentence says a word, whole and in any case: `mark` must not be answered by `markdown`. */
function saysWord(sentence: string, word: string): boolean {
	const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`\\b${escaped}\\b`, "i").test(sentence);
}

/** The roots no term covers and no exclusion names, so each is a component nobody wrote down. */
function unnamed(roots: readonly string[]): string[] {
	const covered = new Set(TERMS.map((term) => term.root));
	const excluded = new Set(OUT_OF_SCOPE.map((entry) => entry.root));
	return roots.filter((root) => !covered.has(root) && !excluded.has(root));
}

describe("the kit's vocabulary", () => {
	test("names every root the kit's sheets rule", () => {
		// A component added to the sheet with no word in the sentence is the rename bug in reverse.
		expect(unnamed(kitRoots())).toEqual([]);
	});

	test("says a word for every root in the table", () => {
		// One direction of the rename: the sentence dropped the word while the table still holds it.
		const sentence = vocabularySentence();
		expect(TERMS.filter((term) => !saysWord(sentence, term.word)).map((term) => `${term.root}: ${term.word}`)).toEqual(
			[],
		);
	});

	test("rules every root the table names, exactly", () => {
		// The other direction: the class is gone, or its name changed under it.
		expect(
			TERMS.filter((term) => !rulesClass(`${WEB_LAYOUT_CSS}${WEB_COMPONENTS_CSS}`, term.root)).map((term) => term.root),
		).toEqual([]);
	});

	test("keeps every exclusion earning its place", () => {
		// An exclusion must be a root the sheets still rule — a name they no longer rule is a note about
		// nothing — and it must carry the reason it is not a table row.
		const roots = new Set(kitRoots());
		const covered = new Set(TERMS.map((term) => term.root));
		expect(
			OUT_OF_SCOPE.filter((entry) => !roots.has(entry.root) || covered.has(entry.root) || entry.why.trim() === "").map(
				(entry) => entry.root,
			),
		).toEqual([]);
	});

	test("reads the sentence it thinks it reads", () => {
		// The guard is vacuous if the heading or the paragraph moves; this is the read, pinned.
		expect(vocabularySentence()).toContain("marks the kit");
		expect(saysWord(vocabularySentence(), "markdown body")).toBe(true);
	});

	test("reddens on a dropped root and on a stale word, so a green means what it says", () => {
		// Two self-tests fed through the same filters: a sentence that lost `tags`, and a table row the
		// sheet no longer rules. `ef01313c`'s `.bf-card` is the class that would have been caught.
		const sentence = "brand and mark, tabs, and a card";
		expect(TERMS.filter((term) => !saysWord(sentence, term.word)).map((term) => term.root)).toContain("bf-tag");
		expect(rulesClass(WEB_COMPONENTS_CSS, "bf-card")).toBe(false);
	});
});
