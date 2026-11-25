/**
 * What a browser suite is allowed to wait on.
 *
 * A page closed behind a network wait is a page whose readiness nobody named. `networkidle` is the
 * one spelling that looks like a condition and is a clock: Playwright resolves it after five
 * hundred milliseconds in which the page made no request, whatever the document is doing. Measured
 * on the review page, the same page and the same readiness wait cost 682–745 ms under
 * `networkidle` and 184–196 ms under `load`, and the difference bought nothing — the page is one
 * script that restores its drafts before it returns, so `load` is already the fact a case needs.
 *
 * The scan reads the AST rather than the text, because a string in a comment or an assertion is not
 * a wait. It covers `test/helpers/` as well as the suites: one of the floors lived in
 * `openReviewPage`, so every suite in five files paid it without naming it once.
 *
 * The exemption list is keyed by file rather than by line, because the file that still carries a
 * floor is owed a conversion as a whole. An entry that no longer holds a floor fails as stale, and
 * the list may not grow: a second entry is a second card that never landed.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative as relativePath } from "node:path";
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { BROWSER_SUITES, SMOKE_SUITES } from "./helpers/browser-suites.ts";
import { posixPath, walkFiles } from "./helpers/files.ts";

const repo = join(import.meta.dir, "..");

/** A source file to check, and the path its failures are reported under. */
export interface Source {
	path: string;
	text: string;
}

/** The directories whose sources the guard covers. */
const TEST_DIRS = ["extensions", "lib", "scripts", "test"];

/**
 * The files that may still carry a floor, and the card that owes its conversion.
 *
 * A whole-file entry rather than a line: the five waits in this file are one card's work, and a
 * line number would be rewritten by the first edit above it — which is how a pin turns into a
 * re-run rather than a fix.
 */
const NETWORKIDLE_EXCEPTIONS = [
	{
		path: "extensions/code-review/view/interaction.test.ts",
		why: "#885 (sam) holds this file; its five waits convert with that card, and this entry goes then",
	},
];

/** The message one offending wait reports. */
function networkidleOffence(path: string, line: number, form: string): string {
	return `${path}:${line}: waits on \`${form}\` — that is Playwright's idle floor, not the page's readiness; wait on the condition the assertion reads (\`load\` plus the page's own first paint)`;
}

/** Whether an object-literal key is the name given. */
function isKeyed(name: ts.PropertyName, wanted: string): boolean {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text === wanted;
	return false;
}

/** Every network-idle wait in `source`, except the files {@link NETWORKIDLE_EXCEPTIONS} names. */
export function networkidleProblems(source: Source): string[] {
	if (NETWORKIDLE_EXCEPTIONS.some((entry) => entry.path === source.path)) return [];
	const file = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const found: string[] = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isPropertyAssignment(node) &&
			isKeyed(node.name, "waitUntil") &&
			ts.isStringLiteral(node.initializer) &&
			node.initializer.text === "networkidle"
		) {
			const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
			found.push(networkidleOffence(source.path, line + 1, "networkidle"));
		}
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === "waitForLoadState"
		) {
			const state = node.arguments[0];
			if (state !== undefined && ts.isStringLiteral(state) && state.text === "networkidle") {
				const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
				found.push(networkidleOffence(source.path, line + 1, "waitForLoadState('networkidle')"));
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

/** Every source the guard reads: the suites, and the helpers that wait for them. */
function guardedSources(): string[] {
	const suites = TEST_DIRS.flatMap((dir) => walkFiles(join(repo, dir))).filter((file) => file.endsWith(".test.ts"));
	const helpers = readdirSync(join(repo, "test", "helpers"))
		.filter((file) => file.endsWith(".ts"))
		.map((file) => join(repo, "test", "helpers", file));
	return [...suites, ...helpers].map((file) => posixPath(relativePath(repo, file))).sort();
}

describe("network-idle waits", () => {
	test("no suite or helper waits on networkidle", () => {
		const sources = guardedSources();
		// A walk that found nothing would make the scan below vacuous.
		expect(sources.length).toBeGreaterThan(0);
		const offenders = sources.flatMap((path) =>
			networkidleProblems({ path, text: readFileSync(join(repo, path), "utf-8") }),
		);
		expect(offenders).toEqual([]);
	});

	test("every exception still holds a floor", () => {
		// A file-level pin is a promise too: once the card lands, the entry's reason is no longer
		// the reason the code has, and the exemption has to go with the floor it excused.
		const stale = NETWORKIDLE_EXCEPTIONS.filter((entry) => {
			const text = readFileSync(join(repo, entry.path), "utf-8");
			return !text.includes("networkidle");
		}).map((entry) => `${entry.path}: no networkidle left; drop the entry with the card it names`);
		expect(stale).toEqual([]);
	});

	test("the exception list has no room to grow", () => {
		expect(NETWORKIDLE_EXCEPTIONS).toHaveLength(1);
	});

	test("names a networkidle wait with its line, in either spelling", () => {
		const text = [
			'await page.goto(url, { waitUntil: "networkidle" });',
			'await page.waitForLoadState("networkidle");',
			'await page.goto(url, { waitUntil: "load" });',
		].join("\n");
		expect(networkidleProblems({ path: "example.test.ts", text })).toEqual([
			networkidleOffence("example.test.ts", 1, "networkidle"),
			networkidleOffence("example.test.ts", 2, "waitForLoadState('networkidle')"),
		]);
	});

	test("ignores the word in a comment, a string, and another wait's value", () => {
		const text = [
			"// networkidle was here once",
			'const note = "networkidle";',
			'await page.goto(url, { waitUntil: "domcontentloaded" });',
		].join("\n");
		expect(networkidleProblems({ path: "example.test.ts", text })).toEqual([]);
	});
});

/** One boot helper's import, as a suite that drives Chrome reaches it. */
const BOOT_IMPORT = /test\/helpers\/(?:browser|board-browser|plan-browser|review-browser)\.ts/;

/** The extension suites that import a boot helper, repo-relative and sorted. */
function bootingSuites(): string[] {
	return guardedSources()
		.filter((path) => path.startsWith("extensions/") && path.endsWith(".test.ts"))
		.filter((path) => BOOT_IMPORT.test(readFileSync(join(repo, path), "utf-8")));
}

describe("the browser-suite declaration", () => {
	test("names every extension suite that boots a browser, and only those", () => {
		const declared = [...BROWSER_SUITES].sort();
		const tree = bootingSuites();
		// Both directions, because one of them is the defect this file was written for: a list of
		// seven pinned a hook rule while forty files booted a browser and nothing counted the rest.
		expect(
			tree.filter((path) => !declared.includes(path)),
			"a browser suite missing from test/helpers/browser-suites.ts — declare it, so the hook rule covers it",
		).toEqual([]);
		expect(
			declared.filter((path) => !tree.includes(path)),
			"declared as a browser suite but imports no boot helper — drop the entry or the import",
		).toEqual([]);
	});

	test("the smoke tier is a strict subset of the layer", () => {
		// The local gate runs these and ignores the rest, so a smoke suite outside the layer would be
		// ignored everywhere, and a tier as wide as the layer would save nothing.
		expect(SMOKE_SUITES.length).toBeGreaterThan(0);
		expect(SMOKE_SUITES.length).toBeLessThan(BROWSER_SUITES.length);
		for (const suite of SMOKE_SUITES) expect(BROWSER_SUITES).toContain(suite);
	});
});
