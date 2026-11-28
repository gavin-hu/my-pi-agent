/**
 * The `[Unreleased]` list: the heading a card's type earns, and one bullet at its head.
 *
 * The landing is the one writer of a changelog bullet, so this module owns the two decisions a
 * hand-written bullet never had to state — which Keep a Changelog subsection a card belongs under,
 * and where in that subsection a new entry goes. Text in, text out: the landing reads the base's
 * file through git and writes back what this returns, so a suite proves the insertion without a
 * repository or a temporary directory.
 *
 * The prose is the card's title, and a title is a sentence whose first word is capitalised, while the
 * bullets beside it all open lowercase. {@link lowerFirst} takes that capital back — an article
 * always, and a plain word of three letters or more — and leaves an acronym, a code span, and a
 * two-letter name like `Pi` as the author wrote them. Two residuals remain, and both are the title's
 * to fix: an opener like `In` or `It` keeps its capital at two letters, and a three-letter name
 * (`Bun`) is lowercased with the imperatives.
 */

import type { CardType } from "./kind.ts";

/** Keep a Changelog's subsections, in the order the file must hold them. */
export const CHANGELOG_SECTIONS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"] as const;

/** One subsection name. */
export type ChangelogSection = (typeof CHANGELOG_SECTIONS)[number];

/** The window every change is written into first. */
const UNRELEASED = /^## \[Unreleased\]\s*$/;

/** Any release window's heading, which ends the one above it. */
const WINDOW = /^## \[/;

/** A subsection heading, whose name is what its list belongs to. */
const SUBSECTION = /^### (.+?)\s*$/;

/** A bullet opens on `- `; `test/release.test.ts` reads the wrapped lines under it as its prose. */
const BULLET = /^- /;

/**
 * The heading a card's type earns.
 *
 * A card with no type lands under `Changed`, the one heading that promises nothing false. The
 * absence is an authoring gap rather than a landing one — `board add` takes a `type` — so nothing
 * here guesses one from a title: a bug that lands under `Changed` is a card written without its
 * type, which is the thing to fix and not a reading to invent.
 */
export function headingFor(type: CardType | undefined): ChangelogSection {
	switch (type) {
		case "feature":
			return "Added";
		case "bug":
			return "Fixed";
		case "refactor":
		case "docs":
		case "test":
		case "chore":
		case undefined:
			return "Changed";
	}
}

/** An article opens a sentence and is never a name, so its capital always goes. */
const ARTICLE = /^(A|An)(?=\s)/;

/** The first word of a title, when it is one a bullet would open lowercase. */
const PLAIN_WORD = /^([A-Z][a-z]{2,})(?=\s|$)/;

/**
 * `text` with its first word lowercased when that word is an article or a plain one, and untouched otherwise.
 *
 * `A` and `An` are named rather than measured: at one and two letters they are the openers a
 * word-length rule leaves capitalised while no reader would call either a name, and "A card's paths
 * are claims" is a card title this board really holds. Every other opener of three letters or more
 * loses its capital, which is what takes the imperatives (`Land`, `Add`) with it. What stays as the
 * author wrote it is a two-letter word that is not an article — `In`, `It` — an acronym, or a code
 * span; and a three-letter name the tree capitalises (`Bun`) is lowercased with the rest, because a
 * vocabulary of the tree's names is a second spelling of them.
 */
export function lowerFirst(text: string): string {
	const article = ARTICLE.exec(text)?.[1];
	if (article !== undefined) return `${article.toLowerCase()}${text.slice(article.length)}`;
	const word = PLAIN_WORD.exec(text)?.[1];
	if (word === undefined) return text;
	return `${word.toLowerCase()}${text.slice(word.length)}`;
}

/**
 * `text` with `line` at the head of `heading`'s list, or `undefined` without an `[Unreleased]` window.
 *
 * The line arrives whole, `- ` included, so the sentence a refusal names is the sentence in the file.
 * It goes above the one already there, because a subsection is newest-first, and a subsection the
 * window does not carry yet is created in Keep a Changelog's order rather than appended —
 * `test/release.test.ts` fails an unknown subsection, an out-of-order one, and an empty one.
 */
export function insertBullet(text: string, heading: ChangelogSection, line: string): string | undefined {
	const lines = text.split("\n");
	const open = lines.findIndex((line) => UNRELEASED.test(line));
	if (open === -1) return undefined;
	const nextWindow = lines.findIndex((line, index) => index > open && WINDOW.test(line));
	const close = nextWindow === -1 ? lines.length : nextWindow;
	const at = sectionAt(lines, open, close, heading);
	if (at !== undefined) {
		const head = listHead(lines, at, close);
		return [...lines.slice(0, head), line, "", ...lines.slice(head)].join("\n");
	}
	const rank = CHANGELOG_SECTIONS.indexOf(heading);
	const before = firstAbove(lines, open, close, rank);
	if (before !== undefined) {
		return [...lines.slice(0, before), `### ${heading}`, "", line, "", ...lines.slice(before)].join("\n");
	}
	// Nothing later in the order to sit above: the section becomes the window's last, and the blank
	// line that closed the window stays behind it, so the next `## [` heading keeps its separation.
	const tail = tailOf(lines, open, close);
	return [...lines.slice(0, tail), "", `### ${heading}`, "", line, ...lines.slice(tail)].join("\n");
}

/** The index of `heading`'s own subsection heading in the window, or `undefined` when it has none. */
function sectionAt(lines: readonly string[], open: number, close: number, heading: string): number | undefined {
	for (let index = open + 1; index < close; index += 1) {
		if (SUBSECTION.exec(lines[index] ?? "")?.[1] === heading) return index;
	}
	return undefined;
}

/** Where a subsection's first bullet opens, or where an empty one is given its first. */
function listHead(lines: readonly string[], at: number, close: number): number {
	for (let index = at + 1; index < close; index += 1) {
		const line = lines[index] ?? "";
		if (SUBSECTION.test(line)) break;
		if (BULLET.test(line)) return index;
	}
	// No entry yet: the bullet follows the heading's own blank line, so the section keeps the space
	// between its heading and its content that every other section has.
	const next = at + 1;
	return (lines[next] ?? "").trim() === "" ? next + 1 : next;
}

/** The index of the first subsection heading the order puts after `rank`, or `undefined`. */
function firstAbove(lines: readonly string[], open: number, close: number, rank: number): number | undefined {
	for (let index = open + 1; index < close; index += 1) {
		const name = SUBSECTION.exec(lines[index] ?? "")?.[1];
		if (name !== undefined && CHANGELOG_SECTIONS.indexOf(name as ChangelogSection) > rank) return index;
	}
	return undefined;
}

/** The index after the window's last non-blank line, where a new final subsection begins. */
function tailOf(lines: readonly string[], open: number, close: number): number {
	let index = close;
	while (index > open + 1 && (lines[index - 1] ?? "").trim() === "") index -= 1;
	return index;
}
