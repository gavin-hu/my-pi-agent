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
 */

import { describe, expect, test } from "bun:test";
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

	test("are found, so a scan that matched nothing cannot pass", () => {
		// The board's bundle alone splices eight; a future rename of the convention shows up here
		// rather than as a guard that quietly checks an empty list.
		expect(found.length).toBeGreaterThan(20);
		expect(functions.size).toBeGreaterThan(50);
	});

	test("cross through pageSource, and no other way", () => {
		expect(unrouted(found, functions), "a spliced body must reach the page under its helper's own name").toEqual([]);
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
