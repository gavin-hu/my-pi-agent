/**
 * The shot scripts' selectors, held to the pages they drive.
 *
 * A capture is asked for in words — `capture:board`, `capture:plan` — and the script behind it
 * waits on a class or an id it names in a string. Nothing type-checks a string, so a rename
 * reaches a shot script only when somebody runs it: the board's shell moved `.board-card` to
 * `.board-row` and this file's subject, `--dialog card`, threw "Cannot read properties of null"
 * while every suite stayed green.
 *
 * The guard is static on purpose. A readiness expression that never turns true is not fatal —
 * the shot waits, then photographs a page it never understood — so the failure to catch is
 * "the page cannot emit this name at all". That question is answered by reading the page: its
 * served document, its client bundle (which is where a row is painted), and, for the pages
 * whose shell is a template literal, the module that writes it.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOARD_CLIENT_JS } from "../extensions/board/view/client.ts";
import { CLIENT_JS as BROWSE_CLIENT_JS } from "../extensions/file-browse/view/client.ts";
import { REVIEW_CLIENT_JS } from "../extensions/plan/web-client.ts";
import { boardDocument } from "../test/helpers/board-document.ts";

const ROOT = join(import.meta.dir, "..");

/** A class or an id, which is all a selector may name that a page has to be able to emit. */
const NAME = /[.#]([a-zA-Z][\w-]*)/g;

/** A `querySelector`/`querySelectorAll` call and the literal it was handed. */
const SELECTOR = /querySelector(?:All)?\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`]*)`)/g;

/**
 * Every selector literal in one script, with the string unescaped.
 *
 * The dialog click is written inside a double-quoted expression that is itself a string, so
 * its quotes arrive as `\"`; a reader that did not unescape them would see a truncated name
 * and pass a selector that is wrong.
 */
function selectorsIn(source: string): string[] {
	return [...source.matchAll(SELECTOR)].map((match) =>
		(match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'`\\])/g, "$1"),
	);
}

/** The class and id names a selector asks for. */
function namesIn(selector: string): string[] {
	return [...selector.matchAll(NAME)].map((match) => match[1] ?? "");
}

function source(rel: string): string {
	return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * What each page-driven script can legitimately wait on.
 *
 * The document is the server's own markup; the bundle is the class table and the fragments
 * spliced into it, which is where a painted row's names live; the module source covers a shell
 * written as a template literal, whose classes never reach a bundle.
 */
const PAGES: Readonly<Record<string, () => string>> = {
	"scripts/shots/board.ts": () => [boardDocument("board"), boardDocument("team"), BOARD_CLIENT_JS].join("\n"),
	"scripts/shots/file-browse.ts": () => [source("extensions/file-browse/view/html.ts"), BROWSE_CLIENT_JS].join("\n"),
	"scripts/shots/plan-review.ts": () =>
		[source("extensions/plan/web-page.ts"), source("extensions/plan/web-blocks.ts"), REVIEW_CLIENT_JS].join("\n"),
};

describe("the shot scripts' selectors", () => {
	test("finds the selectors it claims to check", () => {
		// A parser that stopped matching would make every case below vacuous: the board script
		// alone hands four literals to a query, one of them the click that opens the dialog.
		for (const [script, page] of Object.entries(PAGES)) {
			const found = selectorsIn(source(script));
			expect(found.length, script).toBeGreaterThan(0);
			expect(namesIn(found.join(" ")).length, script).toBeGreaterThan(0);
			expect(page().length, script).toBeGreaterThan(1_000);
		}
		// The board script is the one that both waits and clicks: four literals, one of them the
		// dialog click that broke.
		expect(selectorsIn(source("scripts/shots/board.ts")).length).toBeGreaterThan(2);
	});

	for (const [script, page] of Object.entries(PAGES)) {
		test(`${script} waits on names its page emits`, () => {
			const corpus = page();
			const unknown = [...new Set(selectorsIn(source(script)).flatMap(namesIn))]
				.filter((name) => !corpus.includes(name))
				.sort();
			expect(unknown).toEqual([]);
		});
	}

	test("reads a name through the escaping a nested expression needs", () => {
		// The dialog click lived in a double-quoted string inside a double-quoted string for as
		// long as it worked; the reader has to see the name, not the backslashes.
		const nested = "document.querySelector('.board-row[data-card=\\\"1\\\"] .bf-row__title')";
		expect(selectorsIn(nested)).toEqual(['.board-row[data-card="1"] .bf-row__title']);
		expect(namesIn(selectorsIn(nested)[0] ?? "")).toEqual(["board-row", "bf-row__title"]);
	});
});
