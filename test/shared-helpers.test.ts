/**
 * Shared-helper guard: an extension must not reimplement what `lib/` owns.
 *
 * Two rules, both over top-level functions and function-valued constants in
 * non-test TypeScript:
 *
 *   1. A local declaration whose name is also exported by `lib/` is a
 *      reimplementation, unless the declaration is a reviewed exception.
 *   2. A local body identical to an exported `lib/` body, or to a body in a
 *      different extension, is a copy. Bodies are compared as normalized token
 *      sequences, comments and whitespace removed, with a small token floor.
 *
 * Rule 2 catches a copy in the pull request that introduces it, before the two
 * copies can diverge. A copy that is later renamed *and* changed is review
 * territory; the guard deliberately stays exact to keep legitimate wrappers
 * (`sanitizeInbound`, `buildCommand`, `formatElapsed`) out of the report.
 *
 * The guard is a CI check only: it runs as part of `bun test`, which
 * `bun run check` and the CI workflow already run. There is no runtime hook.
 */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { walkFiles } from "./helpers/files.ts";

const repo = join(import.meta.dir, "..");
const MIN_TOKENS = 10;

/**
 * Legitimate same-name wrappers, each with the reason it is not drift.
 * Keyed by `<repo-relative path>:<symbol>`.
 */
const SAME_NAME_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
	[
		"extensions/web-access/search/json.ts:asRecord",
		"provider response shaper returns {} and accepts arrays; lib asRecord narrows config files",
	],
	["extensions/plan/plans.ts:repoRoot", "caps the shared repoRootFor call at five seconds for a plan-store lookup"],
	["extensions/worktree/git.ts:repoRoot", "canonicalizes the shared repoRootFor result for worktree path comparison"],
	[
		"extensions/file-browse/markdown.ts:isBlank",
		"the Markdown renderer stays free of TUI imports; its blank test is a local one-liner",
	],
	[
		"extensions/rewind/timeline.ts:messageText",
		"flattens an unknown session content value; lib messageText takes a tool result",
	],
	[
		"extensions/subagent/format.ts:clip",
		"strips the ANSI resets truncation emits so the caller can colorize; lib clip preserves them",
	],
	[
		"extensions/wechat/state.ts:emptyState",
		"returns the extension's state shape, not the TUI empty-state block lib exports",
	],
	["extensions/worktree/git.ts:currentBranch", "wraps the shared runner with the extension's ExtensionAPI seam"],
	["extensions/worktree/git.ts:hasCommits", "wraps the shared runner with the extension's ExtensionAPI seam"],
	[
		"extensions/worktree/prune.ts:ageInDays",
		"measures directory mtime plus a registry timestamp; lib ageInDays measures a date string",
	],
]);

/**
 * Legitimate identical bodies, each with the reason sharing would be worse.
 * Keyed by `<repo-relative path>:<symbol>`.
 */
const SAME_BODY_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
	[
		"extensions/job/format.ts:statusGlyph",
		"one-line paint of each extension's own statusRole and statusGlyphChar, which differ",
	],
	[
		"extensions/watch/format.ts:statusGlyph",
		"one-line paint of each extension's own statusRole and statusGlyphChar, which differ",
	],
]);

type Surface = "lib" | "extension";

interface Source {
	/** Repo-relative, posix-normalized. */
	path: string;
	surface: Surface;
	text: string;
}

interface Declaration {
	path: string;
	surface: Surface;
	/** Extension directory name, or an empty string for `lib/`. */
	extension: string;
	name: string;
	/** Normalized token fingerprint. */
	body: string;
	tokens: number;
}

function extensionOf(path: string): string {
	return path.split("/")[1] ?? "";
}

/** The body's scanner tokens: comments and whitespace gone, identifiers kept. */
function fingerprint(body: ts.Node, file: ts.SourceFile): { body: string; tokens: number } {
	const scanner = ts.createScanner(
		ts.ScriptTarget.Latest,
		/* skipTrivia */ true,
		ts.LanguageVariant.Standard,
		body.getText(file),
	);
	const tokens: string[] = [];
	for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
		tokens.push(scanner.getTokenText());
	}
	return { body: tokens.join("\u0000"), tokens: tokens.length };
}

/** Top-level function declarations and `const name = function/arrow` declarations. */
function declarationsOf(source: Source): Declaration[] {
	const file = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const found: Declaration[] = [];

	const add = (name: ts.Identifier | undefined, body: ts.ConciseBody | undefined): void => {
		if (name === undefined || body === undefined) return;
		const print = fingerprint(body, file);
		found.push({
			path: source.path,
			surface: source.surface,
			extension: source.surface === "extension" ? extensionOf(source.path) : "",
			name: name.text,
			...print,
		});
	};

	for (const statement of file.statements) {
		if (ts.isFunctionDeclaration(statement)) {
			add(statement.name, statement.body);
			continue;
		}
		if (!ts.isVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
			if (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer)) continue;
			add(declaration.name, declaration.initializer.body);
		}
	}
	return found;
}

/** Rule violations, sorted and de-duplicated by message. */
export function findViolations(
	sources: readonly Source[],
	exceptions: ReadonlyMap<string, string> = SAME_NAME_EXCEPTIONS,
): string[] {
	const declarations = sources.flatMap(declarationsOf);
	const libDeclarations = declarations.filter((entry) => entry.surface === "lib");
	const extensionDeclarations = declarations.filter((entry) => entry.surface === "extension");
	const libByName = new Map<string, Declaration[]>();
	for (const declaration of libDeclarations) {
		const matches = libByName.get(declaration.name) ?? [];
		matches.push(declaration);
		libByName.set(declaration.name, matches);
	}

	const violations: string[] = [];
	const alreadyReported = new Set<string>();
	const flag = (declaration: Declaration): void => {
		alreadyReported.add(`${declaration.path}:${declaration.name}`);
	};

	for (const declaration of extensionDeclarations) {
		const matches = libByName.get(declaration.name);
		if (matches === undefined || matches.length === 0) continue;
		if (exceptions.has(`${declaration.path}:${declaration.name}`)) continue;
		const target = matches[0];
		violations.push(
			`${declaration.path}:${declaration.name} declares its own helper; import ${target.name} from ${target.path}`,
		);
		flag(declaration);
	}

	const byBody = new Map<string, Declaration[]>();
	for (const declaration of [...libDeclarations, ...extensionDeclarations]) {
		if (declaration.tokens < MIN_TOKENS) continue;
		const group = byBody.get(declaration.body) ?? [];
		group.push(declaration);
		byBody.set(declaration.body, group);
	}

	for (const group of byBody.values()) {
		const libMatches = group.filter((entry) => entry.surface === "lib");
		const extensionMatches = group.filter((entry) => entry.surface === "extension");
		if (extensionMatches.length === 0) continue;
		const extensionDirs = new Set(extensionMatches.map((entry) => entry.extension));
		const copiesAcrossExtensions = extensionDirs.size > 1;
		if (libMatches.length === 0 && !copiesAcrossExtensions) continue;

		for (const declaration of extensionMatches) {
			if (alreadyReported.has(`${declaration.path}:${declaration.name}`)) continue;
			if (SAME_BODY_EXCEPTIONS.has(`${declaration.path}:${declaration.name}`)) continue;
			const others = group
				.filter((entry) => entry !== declaration)
				.map((entry) => `${entry.path}:${entry.name}`)
				.sort();
			const verb = libMatches.length > 0 ? "copies" : "duplicates";
			violations.push(
				`${declaration.path}:${declaration.name} ${verb} ${others.join(", ")} (${declaration.tokens} tokens); share one helper in lib/`,
			);
			flag(declaration);
		}
	}

	return [...new Set(violations)].sort();
}

function sourceOf(path: string, text: string): Source {
	return { path, surface: path.startsWith("lib/") ? "lib" : "extension", text };
}

/** Every non-test TypeScript file under `lib/` and `extensions/`. */
function repoSources(): Source[] {
	const files = [...walkFiles(join(repo, "lib")), ...walkFiles(join(repo, "extensions"))].filter(
		(file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
	);
	return files.map((file) => {
		const path = relative(repo, file).replaceAll("\\", "/");
		return sourceOf(path, readFileSync(file, "utf-8"));
	});
}

const libFixture = `
export function clip(text: string, width: number): string {
	const clean = text.trim();
	return clean.length > width ? clean.slice(0, width) : clean;
}
`;

describe("shared-helper guard", () => {
	test("fails a same-name reimplementation of a lib helper", () => {
		const violations = findViolations([
			sourceOf("lib/format.ts", libFixture),
			sourceOf(
				"extensions/a/format.ts",
				"function clip(text: string, width: number): string { return text.slice(0, width); }",
			),
		]);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("extensions/a/format.ts:clip declares its own helper");
	});

	test("fails a renamed copy of a lib body", () => {
		const violations = findViolations([
			sourceOf("lib/format.ts", libFixture),
			sourceOf(
				"extensions/a/format.ts",
				"function trim(text: string, width: number): string { const clean = text.trim(); return clean.length > width ? clean.slice(0, width) : clean; }",
			),
		]);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("extensions/a/format.ts:trim copies lib/format.ts:clip");
	});

	test("fails the same body in two different extensions", () => {
		const body = "function pair(text: string): string { const clean = text.trim(); return clean.toUpperCase(); }";
		const violations = findViolations([sourceOf("extensions/a/x.ts", body), sourceOf("extensions/b/y.ts", body)]);
		expect(violations).toHaveLength(2);
		expect(violations.every((line) => line.includes("duplicates"))).toBe(true);
	});

	test("honours a reasoned same-name exception", () => {
		const violations = findViolations(
			[
				sourceOf("lib/format.ts", libFixture),
				sourceOf(
					"extensions/a/format.ts",
					"function clip(text: string, width: number): string { return text.slice(0, width); }",
				),
			],
			new Map([["extensions/a/format.ts:clip", "a documented wrapper"]]),
		);
		expect(violations).toEqual([]);
	});

	test("ignores short bodies and duplicates inside one extension", () => {
		const short = "function noop(): void { return; }";
		const sameExtension =
			"function pair(text: string): string { const clean = text.trim(); return clean.toUpperCase(); }";
		const violations = findViolations([
			sourceOf("extensions/a/x.ts", short),
			sourceOf("extensions/a/y.ts", short),
			sourceOf("extensions/a/one.ts", sameExtension),
			sourceOf("extensions/a/two.ts", sameExtension),
		]);
		expect(violations).toEqual([]);
	});

	test("every exception names a declaration that still exists", () => {
		const known = new Set(
			repoSources()
				.flatMap(declarationsOf)
				.map((entry) => `${entry.path}:${entry.name}`),
		);
		const missing = [...SAME_NAME_EXCEPTIONS.keys(), ...SAME_BODY_EXCEPTIONS.keys()].filter((key) => !known.has(key));
		expect(missing, "delete the exception: the declaration it names is gone").toEqual([]);
	});

	test("the exception lists have no room to grow", () => {
		// Shrink these as helpers move into lib/; a new copy is extracted, not excepted.
		expect(SAME_NAME_EXCEPTIONS.size).toBe(10);
		expect(SAME_BODY_EXCEPTIONS.size).toBe(2);
	});

	test("the real tree has no shared-helper drift", () => {
		const sources = repoSources();
		const declarations = sources.flatMap(declarationsOf);
		// A parser that stopped finding declarations would make the check vacuous.
		expect(declarations.filter((entry) => entry.surface === "lib").length).toBeGreaterThan(50);
		expect(declarations.filter((entry) => entry.surface === "extension").length).toBeGreaterThan(100);
		expect(findViolations(sources)).toEqual([]);
	});
});
