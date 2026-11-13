/**
 * The bodies a served page receives, and the one way they get there.
 *
 * A `*_JS` constant is a page's copy of a function: the fragment holds the *body*, under its
 * own name, because a page has no import graph. The host loads an extension through a
 * transpiler, though, and it rewrites a call to an *imported* binding into a module member —
 * `sameLabel(a, b)` becomes `(0, _sessionLabel.sameLabel)(a, b)` — so a body spliced as
 * `String(fn)` reached the page calling a module nothing holds: `_sessionLabel is not
 * defined`, on the first paint, while every suite was green because `bun`'s transpiler leaves
 * the call site alone.
 *
 * `lib/format.ts`'s `pageSource` strips that, so the rule is not "the body must be
 * self-contained" — a body may call a helper the page also holds — but "the body crosses
 * through `pageSource`", which survives the next refactor that hoists a helper.
 *
 * The strip has a price the second check here holds: it writes `_x.member` back to `member`
 * wherever a body spells it, because that is what the transpiler's own read looks like. So a
 * body names nothing of its own with a leading underscore, and one that writes that form fails
 * here rather than reading the wrong value on a page, which nothing else would report.
 */

import { describe, expect, test } from "bun:test";
import { bodyAfter } from "./helpers/bundle.ts";
import { extensionsDir, libDir, relative, sourceFiles, textOf } from "./helpers/scan.ts";

/** A declaration of a page-bound constant: its file, its first line's number, and its text. */
interface Splice {
	file: string;
	line: number;
	text: string;
}

/** Every name a module exports as a function, so a coercion on a variable is not read as a splice. */
function exportedFunctions(): Set<string> {
	const names = new Set<string>();
	for (const root of [libDir, extensionsDir]) {
		for (const file of sourceFiles(root)) {
			const text = textOf(file);
			for (const match of text.matchAll(/export (?:async )?function ([A-Za-z_$][\w$]*)\s*[<(]/g))
				names.add(match[1] ?? "");
			for (const match of text.matchAll(/export const ([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) {
				names.add(match[1] ?? "");
			}
		}
	}
	return names;
}

/**
 * One `*_JS` declaration's lines: from `export const … _JS =` to the line that closes it.
 *
 * The close is the first line ending in `;` once the backticks it has opened are closed, since
 * a bundle is one template literal and a declaration inside it is one statement.
 */
function spliceAt(file: string, lines: string[], start: number): Splice {
	let backticks = 0;
	let text = "";
	for (let index = start; index < lines.length; index++) {
		const line = lines[index] ?? "";
		text += line;
		backticks += (line.match(/(?<!\\)`/g) ?? []).length;
		if (line.trimEnd().endsWith(";") && backticks % 2 === 0) break;
		text += "\n";
	}
	return { file, line: start + 1, text };
}

/** The `_x.member` form `pageSource` writes back to `member`, wherever a body spells it. */
const UNDERSCORE_FIELD = /(?<![\w$.])_[A-Za-z$][\w$]*\.[A-Za-z$][\w$]*/;

/** The names one declaration hands to `pageSource`, in the called form and the mapped one. */
function splicedNames(text: string): string[] {
	const names = new Set<string>();
	for (const match of text.matchAll(/pageSource\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) names.add(match[1] ?? "");
	for (const match of text.matchAll(/\[([^\]]*)\]\.map\(pageSource\)/g)) {
		for (const name of (match[1] ?? "").split(",")) {
			const trimmed = name.trim();
			if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) names.add(trimmed);
		}
	}
	return [...names].sort();
}

/**
 * Every function body in the tree, by name.
 *
 * By name rather than by module because a spliced helper need not live where it is spliced: the
 * board's `skippedText` is imported from another module. A name declared twice is checked twice,
 * which fails loudly rather than passing the wrong body.
 */
function bodies(): Map<string, { file: string; text: string }[]> {
	const found = new Map<string, { file: string; text: string }[]>();
	for (const root of [libDir, extensionsDir]) {
		for (const file of sourceFiles(root)) {
			const text = textOf(file);
			for (const match of text.matchAll(/(?:export )?(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/g)) {
				const name = match[1] ?? "";
				const body = bodyAfter(text, (match.index ?? 0) + match[0].length);
				found.set(name, [...(found.get(name) ?? []), { file: relative(file), text: body }]);
			}
		}
	}
	return found;
}

/** The spliced bodies that spell a form the rewrite eats, as `file: name writes form`. */
function underscoreFields(
	found: readonly Splice[],
	index: ReadonlyMap<string, { file: string; text: string }[]>,
): string[] {
	const offenders: string[] = [];
	for (const splice of found) {
		for (const name of splicedNames(splice.text)) {
			for (const body of index.get(name) ?? []) {
				const hit = UNDERSCORE_FIELD.exec(body.text)?.[0];
				if (hit !== undefined) offenders.push(`${body.file}: ${name} writes \`${hit}\``);
			}
		}
	}
	return offenders.sort();
}

/** Every page-bound constant in the tree, in file order. */
function splices(): Splice[] {
	const found: Splice[] = [];
	for (const root of [libDir, extensionsDir]) {
		for (const file of sourceFiles(root)) {
			const lines = textOf(file).split("\n");
			lines.forEach((line, index) => {
				if (/^export const \w+_JS\s*=/.test(line)) found.push(spliceAt(relative(file), lines, index));
			});
		}
	}
	return found;
}

/** The sites that stringify a function by a route other than `pageSource`, as `file:line: why`. */
function unrouted(found: readonly Splice[], functions: ReadonlySet<string>): string[] {
	const offenders: string[] = [];
	for (const splice of found) {
		if (splice.text.includes(".map(String)")) {
			offenders.push(`${splice.file}:${splice.line}: \`.map(String)\`; a body crosses as \`.map(pageSource)\``);
		}
		for (const match of splice.text.matchAll(/(?<![.\w$])String\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
			if (match[1] !== undefined && functions.has(match[1])) {
				offenders.push(
					`${splice.file}:${splice.line}: \`String(${match[1]})\`; a body crosses as \`pageSource(${match[1]})\``,
				);
			}
		}
	}
	return offenders.sort();
}

describe("the bodies a page receives", () => {
	const functions = exportedFunctions();
	const found = splices();
	const index = bodies();

	test("are found, so a scan that matched nothing cannot pass", () => {
		// The board's bundle alone splices eight; a future rename of the convention shows up here
		// rather than as a guard that quietly checks an empty list.
		expect(found.length).toBeGreaterThan(20);
		expect(functions.size).toBeGreaterThan(50);
	});

	test("cross through pageSource, and no other way", () => {
		expect(unrouted(found, functions), "a spliced body must reach the page under its helper's own name").toEqual([]);
	});

	test("resolve a body for every name they splice, so the check below cannot pass vacuously", () => {
		const missing = found.flatMap((splice) =>
			splicedNames(splice.text)
				.filter((name) => !index.has(name))
				.map((name) => `${splice.file}:${splice.line}: ${name} has no body`),
		);
		expect(missing).toEqual([]);
		expect(index.size).toBeGreaterThan(50);
	});

	test("name nothing of their own with a leading underscore", () => {
		// `pageSource` writes `_x.member` back to `member`, and a page reading the wrong value is
		// quieter than a crash: nothing downstream would say the body was rewritten.
		expect(
			underscoreFields(found, index),
			"a spliced body names nothing of its own with a leading underscore; spell `_x.y` some other way",
		).toEqual([]);
	});

	test("fails the one form the rewrite eats, and passes a body that names its own field", () => {
		const splice = [{ file: "lib/x.ts", line: 6, text: "export const A_JS = pageSource(render);" }];
		const eaten = new Map([["render", [{ file: "lib/x.ts", text: "function render() { return _cache.value; }" }]]]);
		expect(underscoreFields(splice, eaten)).toEqual(["lib/x.ts: render writes `_cache.value`"]);
		const kept = new Map([["render", [{ file: "lib/x.ts", text: "function render() { return cache.value; }" }]]]);
		expect(underscoreFields(splice, kept)).toEqual([]);
		// The mapped form names its bodies too, so a fragment spliced as an array is checked alike.
		const mapped = [{ file: "lib/x.ts", line: 7, text: '[render, paint].map(pageSource).join("\\n\\n");' }];
		expect(splicedNames(mapped[0]?.text ?? "")).toEqual(["paint", "render"]);
	});

	test("fails a body stringified straight from its function, and one mapped by name", () => {
		// The hazard, in three lines each: the shape that broke the board's Agents column, and the
		// array form the plan's fragments use.
		const straight = [{ file: "lib/x.ts", line: 1, text: "export const HISTORY_OWNER_JS = String(isHistoryOwner);" }];
		expect(unrouted(straight, new Set(["isHistoryOwner"]))).toEqual([
			"lib/x.ts:1: `String(isHistoryOwner)`; a body crosses as `pageSource(isHistoryOwner)`",
		]);
		const mapped = [{ file: "lib/x.ts", line: 2, text: '[blockElements, setActive].map(String).join("\\n\\n");' }];
		expect(unrouted(mapped, new Set(["blockElements", "setActive"]))).toEqual([
			"lib/x.ts:2: `.map(String)`; a body crosses as `.map(pageSource)`",
		]);
		expect(
			unrouted([{ file: "lib/x.ts", line: 3, text: "export const A_JS = pageSource(a);" }], new Set(["a"])),
		).toEqual([]);
	});

	test("leaves a value's own coercion alone, and a fragment that splices nothing", () => {
		// A class table's value is text, not a body: only a *function* is a body, so this rule has no
		// business rewriting it even when a same-named function exists elsewhere.
		const coercions = [
			{ file: "lib/x.ts", line: 1, text: "export const B_JS = namesScript({ count: String(PICKER_MQ) });" },
		];
		expect(unrouted(coercions, new Set(["isHistoryOwner", "count"]))).toEqual([]);
	});
});
