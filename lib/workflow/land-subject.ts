/**
 * The merge subject a card earns, and the bullet its landing writes.
 *
 * Both are derived from the record rather than supplied, because a landed sha cannot be repaired:
 * a title is already the sentence about what moved, and the paths already name the surface a reader
 * looks for. The subject states that once — `merge(<scope>): <title> (#<id>)` — and the bullet is the
 * same sentence as the changelog spells it, which is the one line a landing adds to the signed tree.
 *
 * Pure: paths in, words out, no git and no filesystem, so the landing keeps its commands and this
 * keeps the reading. It moved out of `land.ts` when the bullet arrived and took the verb past its
 * 600-line bar.
 */

import { posixPath } from "../path.ts";
import type { Card } from "./card.ts";
import { lowerFirst } from "./changelog.ts";

/**
 * A card's title often opens with its scope — `board:`, or the `docs(board):` a typed title uses.
 *
 * It is read twice and must mean one thing both times: `landSubject` strips it so the subject
 * states the scope once, and `landScope` takes it as the scope when the paths name no extension.
 */
const TITLE_SCOPE = /^([\w-]+\([^)]*\)|[\w-]+):\s*/;

/** The one area that is a module: `lib/` is every shared helper's address, not a surface a reader opens. */
const MODULE_AREA = "lib";

/** The extension a path names: `extensions/<name>/<file>`, or the bare directory `extensions/<name>`. */
const EXTENSION_PATH = /^extensions\/([^/]+)(?:\/|$)/;

/** The extension a path names, if it names one. */
function extensionOf(path: string): string | undefined {
	return EXTENSION_PATH.exec(path)?.[1];
}

/** A path's top-level directory, or `undefined` for a file at the repository root. */
function topOf(path: string): string | undefined {
	const [top, ...rest] = path.split("/");
	return rest.length === 0 ? undefined : top;
}

/** The documentation a reader keeps beside the code: a card whose subject is one of these is `docs` work. */
const DOCS_ROOT = new Set(["AGENTS.md", "CONTRIBUTING.md", "README.md", "README.zh-CN.md"]);

/**
 * The area a path names: its top-level directory, unless that is `extensions` — a container, not an
 * area — or, for a file at the repository root, `docs` when that file is documentation.
 *
 * `package.json` and `CHANGELOG.md` name no area on purpose. Both ride another card's work: the
 * manifest is bumped beside the code it describes, and the changelog bullet rides every card, so
 * either one answering would let a rider outvote the work it accompanies. #932 is what the table is
 * for — `CONTRIBUTING.md`'s roster, with `test/drift.test.ts` holding its word ceiling, landed
 * `merge(test)` because the one test file was the only path with a directory to name.
 */
function areaOf(path: string): string | undefined {
	const top = topOf(path);
	if (top !== undefined) return top === "extensions" ? undefined : top;
	return DOCS_ROOT.has(path) ? "docs" : undefined;
}

/**
 * The surface a path names when it is not `name`'s: another extension, or a top-level area other
 * than `lib`. The shared tree, the extension's own page, and a root file are part of the card's
 * work, so they are not something else.
 */
function namedElsewhere(path: string, name: string): string | undefined {
	const other = extensionOf(path);
	if (other !== undefined) return other === name ? undefined : other;
	const top = topOf(path);
	if (top === undefined || top === "lib" || path === `docs/extensions/${name}.md`) return undefined;
	return top;
}

/**
 * The scope a card earns: the one extension its paths name, else the one its title names, else
 * the area its first path is in, else `board`.
 *
 * Paths win, because a card that moves a module and its extension is the extension's work (#853
 * was `merge(plan)` with `lib/mode-state.ts` among its paths) — but only when that extension is
 * where the card's work is. It holds while the paths in it are not outnumbered by the paths that
 * name something else, an area other than `lib` or a second extension, and a tie stays with the
 * extension. #931 is what the count is for: one corrected docstring in another extension's suite,
 * against three `docs/` paths, landed `merge(wechat)` over a card that changed no wechat
 * behaviour, and a landed sha cannot be repaired. `lib/`, the extension's own page
 * (`docs/extensions/<name>.md`), and a root file never count against it.
 *
 * The title is next, because a card whose work lives in `lib/` names no extension at all and its
 * title already says which surface it belongs to — `#868` would otherwise land `merge(board)`
 * under a `session-bus:` title. The area is the rung after that (`docs`, `test`), and `lib` is the
 * one area it may not settle: a card whose work is all shared helpers names no surface, so
 * `landScopeProblem` refuses its landing rather than let it write `merge(lib)` — #1028's subject
 * and bullet both said `lib`, and neither can be repaired. `board` is left for a card that names
 * nothing, which is the one case where the door's own name is the only one left.
 *
 * A path is data: `posixPath` normalises the spelling before anything reads it, so one card earns
 * one scope whatever machine typed it, and a bare `extensions/<name>` counts as that extension
 * because a card whose paths are directories names it just as clearly as one whose paths are files.
 */
export function landScope(card: Pick<Card, "title" | "paths">): string {
	const paths = card.paths.map(posixPath);
	const names = paths.map(extensionOf).filter((name): name is string => name !== undefined);
	const [first] = names;
	if (first !== undefined && names.every((name) => name === first)) {
		// A `test/` ledger rides a card that changes the extension's OWN code, and is the work of one
		// that does not: no such code plus a root ledger is a sweep, whatever else the card touches.
		const own = paths.some((path) => extensionOf(path) === first && !path.endsWith(".test.ts"));
		const ledger = paths.filter((path) => areaOf(path) === "test").length;
		if (own || ledger === 0) {
			const elsewhere = paths.filter(
				(path) => namedElsewhere(path, first) !== undefined && !(own && areaOf(path) === "test"),
			).length;
			if (names.length >= elsewhere) return first;
		}
	}

	const titled = TITLE_SCOPE.exec(card.title)?.[1];
	if (titled !== undefined) return titled;

	for (const path of paths) {
		const area = areaOf(path);
		if (area !== undefined) return area;
	}
	return "board";
}

/**
 * Why a card names no surface, or `undefined` when it names one.
 *
 * A bullet's scope names the surface a reader looks for, never the module a change happens to live
 * in (`CONTRIBUTING.md`, "Commit format"), and the area rung above is the one place that can hand
 * back a module: `lib/` is where every shared helper lives, so `lib/workflow/*.ts` alone earns `lib`.
 * #1028 landed `merge(lib)` that way, with the bullet to match, and a landed subject cannot be
 * repaired — so the door refuses instead. The record names its own surface one rung up (`#868`'s
 * title), which is why the remedy is a retitle rather than a guess from the same paths that produced
 * `lib`. `docs` and `test` are left alone: a documented root file and a sweep both name what a
 * reader opens, and `#932`'s fix depends on the second.
 */
export function landScopeProblem(card: Pick<Card, "title" | "paths">): string | undefined {
	const scope = landScope(card);
	if (scope !== MODULE_AREA) return undefined;
	return `this card names no surface: its scope would be \`${scope}\`, and a bullet's scope names the surface a reader looks for, never the module it happens to live in. Retitle it \`<surface>: <what moved>\` — the surface it serves, \`board\`, \`tui\`, \`session-bus\` — or add the \`extensions/<surface>/\` path the work lives under, then land again: nothing was fetched or merged.`;
}

/**
 * The merge subject a card earns: `merge(<scope>): <title> (#<id>)`.
 *
 * Derived rather than supplied, because a landed sha cannot be repaired: a title is already the
 * sentence about what moved, and the one `scope:` prefix a title often carries is dropped so the
 * subject states it once.
 */
/** A card's title as a landing states it: the one `scope:` prefix dropped, whitespace collapsed. */
function landTitle(card: Pick<Card, "title">): string {
	return card.title.replace(TITLE_SCOPE, "").replace(/\s+/g, " ").trim();
}

export function landSubject(card: Pick<Card, "id" | "title" | "paths">): string {
	return `merge(${landScope(card)}): ${landTitle(card)} (#${card.id})`;
}

/**
 * The bullet this card's landing writes into `CHANGELOG.md`: the subject's scope and title, and the id.
 *
 * Derived rather than typed for the subject's own reason — a landed sha cannot be repaired — and for
 * one more: this line is the only difference between the signed tree and the landed one, so it has to
 * be the record's sentence rather than a second copy of it. Its first word is lowercased where the
 * file's own bullets all open that way; `lowerFirst` says where that stops.
 */
export function landBullet(card: Pick<Card, "id" | "title" | "paths">): string {
	return `- \`${landScope(card)}\`: ${lowerFirst(landTitle(card))} (#${card.id})`;
}
