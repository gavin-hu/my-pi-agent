/**
 * Shared-helper guard: an extension must not reimplement what `lib/` owns, and a
 * test must not re-declare what `test/helpers/` owns.
 *
 * Three rules, over top-level functions and function-valued constants:
 *
 *   1. A local declaration whose name is also exported by `lib/` is a
 *      reimplementation, unless the declaration is a reviewed exception.
 *   2. A local body identical to an exported `lib/` body, or to a body in any
 *      other file, is a copy — two extensions, two modules of one extension, or
 *      two `lib/` modules all count.
 *   3. A `*.test.ts` declaration whose name is exported by `test/helpers/**` is
 *      a re-declaration, and one whose body matches an exported helper body is a
 *      copy. Only exported helpers count: a private fixture helper cannot be
 *      imported.
 *
 * Bodies are compared as normalized token sequences, comments and whitespace
 * removed, with a small token floor. The guards catch a copy in the pull request
 * that introduces it, before the two copies can diverge. A copy that is later
 * renamed *and* changed is review territory; they deliberately stay exact to
 * keep legitimate wrappers (`sanitizeInbound`, `buildCommand`, `formatElapsed`)
 * out of the report.
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
		"extensions/wechat/state/state.ts:emptyState",
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
 * Legitimate identical bodies, each with the reason sharing would be worse. Keyed
 * by `<repo-relative path>:<symbol>`. Empty on purpose: the last two were a
 * one-line `paint` wrapper in `job` and `watch`, so the call sites now use the
 * shared primitive directly.
 */
const SAME_BODY_EXCEPTIONS: ReadonlyMap<string, string> = new Map([]);

type Surface = "lib" | "extension" | "script" | "test";

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
	/** Whether the declaration is exported, so a test could import it. */
	exported: boolean;
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

/** Whether a top-level declaration is exported, so a test could import it. */
function isExported(node: ts.Node): boolean {
	return (
		ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
	);
}

/** Parsed declarations by source object; each real tree is parsed once per test run. */
const declarationCache = new WeakMap<Source, Declaration[]>();

/** Top-level function declarations and `const name = function/arrow` declarations. */
function declarationsOf(source: Source): Declaration[] {
	const cached = declarationCache.get(source);
	if (cached !== undefined) return cached;
	const file = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const found: Declaration[] = [];

	const add = (name: ts.Identifier | undefined, body: ts.ConciseBody | undefined, exported: boolean): void => {
		if (name === undefined || body === undefined) return;
		const print = fingerprint(body, file);
		found.push({
			path: source.path,
			surface: source.surface,
			extension: source.surface === "extension" ? extensionOf(source.path) : "",
			name: name.text,
			exported,
			...print,
		});
	};

	for (const statement of file.statements) {
		if (ts.isFunctionDeclaration(statement)) {
			add(statement.name, statement.body, isExported(statement));
			continue;
		}
		if (!ts.isVariableStatement(statement)) continue;
		const exported = isExported(statement);
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
			if (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer)) continue;
			add(declaration.name, declaration.initializer.body, exported);
		}
	}
	declarationCache.set(source, found);
	return found;
}

/** Rule violations, sorted and de-duplicated by message. */
export function findViolations(
	sources: readonly Source[],
	exceptions: ReadonlyMap<string, string> = SAME_NAME_EXCEPTIONS,
): string[] {
	const declarations = sources.flatMap(declarationsOf);
	const libDeclarations = declarations.filter((entry) => entry.surface === "lib");
	// The consumers: an extension or a capture script. A helper either of them
	// re-declares is owned by `lib/`, which is where the fix imports from.
	const copierDeclarations = declarations.filter((entry) => entry.surface !== "lib" && entry.surface !== "test");
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

	for (const declaration of copierDeclarations) {
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
	for (const declaration of [...libDeclarations, ...copierDeclarations]) {
		if (declaration.tokens < MIN_TOKENS) continue;
		const group = byBody.get(declaration.body) ?? [];
		group.push(declaration);
		byBody.set(declaration.body, group);
	}

	for (const group of byBody.values()) {
		// One file holding one body is fine. The same body in two files is a copy,
		// whether they sit in two extensions, in two modules of one extension, or
		// both in `lib/`: a body identical to an existing one is a duplicate, not a
		// variation, and `extensions/` is read far more often than it is written.
		if (new Set(group.map((entry) => entry.path)).size < 2) continue;
		const libMatches = group.filter((entry) => entry.surface === "lib");
		const copierMatches = group.filter((entry) => entry.surface !== "lib" && entry.surface !== "test");

		for (const declaration of group) {
			// A `lib/` body copied into an extension or a script is reported at the
			// copy: the library is the owner the fix imports from, not an offender.
			if (declaration.surface === "lib" && copierMatches.length > 0) continue;
			if (alreadyReported.has(`${declaration.path}:${declaration.name}`)) continue;
			if (SAME_BODY_EXCEPTIONS.has(`${declaration.path}:${declaration.name}`)) continue;
			const others = group
				.filter((entry) => entry !== declaration)
				.map((entry) => `${entry.path}:${entry.name}`)
				.sort();
			// A copy of a `lib/` helper is imported instead; anything else needs one
			// owner, which is `lib/` only when the two sides are separate extensions.
			const verb = declaration.surface !== "lib" && libMatches.length > 0 ? "copies" : "duplicates";
			const fix = copierMatches.length > 1 ? "share one helper in lib/" : "share one helper";
			violations.push(
				`${declaration.path}:${declaration.name} ${verb} ${others.join(", ")} (${declaration.tokens} tokens); ${fix}`,
			);
			flag(declaration);
		}
	}

	return [...new Set(violations)].sort();
}

/**
 * Legitimate same-name test doubles: the local shape differs from the helper's,
 * so sharing would be wrong. Keyed by `<repo-relative path>:<symbol>`; a real
 * copy is imported instead.
 */
const TEST_HELPER_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
	[
		"extensions/plan/plans.test.ts:tempDir",
		"canonicalizes with realpathSync.native so Windows 8.3 names compare equal",
	],
	[
		"extensions/subagent/agents.test.ts:tempDir",
		"registers the directory for per-test cleanup; delegates to env.tempDir",
	],
	[
		"extensions/wechat/transport/client.test.ts:jsonResponse",
		"returns the wechat client's { status, headers, text } shape, not web-access's body",
	],
]);

/**
 * Rule 3: a test file must not re-declare an exported `test/helpers` name, or
 * copy its body under another name. `helpers` are the owners, `tests` the files
 * under scrutiny.
 */
export function findTestHelperCopies(
	tests: readonly Source[],
	helpers: readonly Source[],
	exceptions: ReadonlyMap<string, string> = TEST_HELPER_EXCEPTIONS,
): string[] {
	const exported = helpers.flatMap(declarationsOf).filter((entry) => entry.exported);
	const byName = new Map(exported.map((entry) => [entry.name, entry]));
	const byBody = new Map<string, Declaration>();
	for (const entry of exported) {
		if (entry.tokens >= MIN_TOKENS && !byBody.has(entry.body)) byBody.set(entry.body, entry);
	}

	const violations: string[] = [];
	for (const declaration of tests.flatMap(declarationsOf)) {
		if (exceptions.has(`${declaration.path}:${declaration.name}`)) continue;
		const sameName = byName.get(declaration.name);
		if (sameName !== undefined) {
			violations.push(
				`${declaration.path}:${declaration.name} re-declares a test helper; import ${sameName.name} from ${sameName.path}`,
			);
			continue;
		}
		if (declaration.tokens < MIN_TOKENS) continue;
		const sameBody = byBody.get(declaration.body);
		if (sameBody !== undefined) {
			violations.push(`${declaration.path}:${declaration.name} copies ${sameBody.path}:${sameBody.name}; import it`);
		}
	}
	return [...new Set(violations)].sort();
}

/** Where a source sits: `lib/` owns helpers, and extensions and scripts consume them. */
function surfaceOf(path: string): Surface {
	if (path.startsWith("lib/")) return "lib";
	if (path.startsWith("scripts/")) return "script";
	return "extension";
}

function sourceOf(path: string, text: string): Source {
	return { path, surface: surfaceOf(path), text };
}

let repoSourcesCache: Source[] | undefined;

/** Every non-test TypeScript file under `lib/`, `extensions/`, and `scripts/`. */
function repoSources(): Source[] {
	if (repoSourcesCache !== undefined) return repoSourcesCache;
	const files = [
		...walkFiles(join(repo, "lib")),
		...walkFiles(join(repo, "extensions")),
		...walkFiles(join(repo, "scripts")),
	].filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
	repoSourcesCache = files.map((file) => {
		const path = relative(repo, file).replaceAll("\\", "/");
		return sourceOf(path, readFileSync(file, "utf-8"));
	});
	return repoSourcesCache;
}

let testSourcesCache: Source[] | undefined;

/** Every `*.test.ts` file under `lib/`, `extensions/`, and `test/`. */
function testSources(): Source[] {
	if (testSourcesCache !== undefined) return testSourcesCache;
	const files = [
		...walkFiles(join(repo, "lib")),
		...walkFiles(join(repo, "extensions")),
		...walkFiles(join(repo, "test")),
	].filter((file) => file.endsWith(".test.ts"));
	testSourcesCache = files.map((file) => ({
		path: relative(repo, file).replaceAll("\\", "/"),
		surface: "test" as const,
		text: readFileSync(file, "utf-8"),
	}));
	return testSourcesCache;
}

let helperSourcesCache: Source[] | undefined;

/** Every non-test module under `test/helpers/`, the owners of the doubles. */
function helperSources(): Source[] {
	if (helperSourcesCache !== undefined) return helperSourcesCache;
	const files = walkFiles(join(repo, "test", "helpers")).filter(
		(file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
	);
	helperSourcesCache = files.map((file) => ({
		path: relative(repo, file).replaceAll("\\", "/"),
		surface: "test" as const,
		text: readFileSync(file, "utf-8"),
	}));
	return helperSourcesCache;
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

	test("ignores short bodies", () => {
		const short = "function noop(): void { return; }";
		const violations = findViolations([sourceOf("extensions/a/x.ts", short), sourceOf("extensions/a/y.ts", short)]);
		expect(violations).toEqual([]);
	});

	test("fails the same body in two modules of one extension", () => {
		const body = "function pair(text: string): string { const clean = text.trim(); return clean.toUpperCase(); }";
		const violations = findViolations([sourceOf("extensions/a/one.ts", body), sourceOf("extensions/a/two.ts", body)]);
		expect(violations).toHaveLength(2);
		expect(violations.every((line) => line.includes("duplicates"))).toBe(true);
		expect(violations.every((line) => line.includes("share one helper"))).toBe(true);
	});

	test("fails the same body in two lib modules", () => {
		const body = "function pair(text: string): string { const clean = text.trim(); return clean.toUpperCase(); }";
		const violations = findViolations([sourceOf("lib/a.ts", body), sourceOf("lib/b.ts", body)]);
		expect(violations).toHaveLength(2);
		expect(violations.every((line) => line.includes("duplicates"))).toBe(true);
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
		expect(SAME_NAME_EXCEPTIONS.size).toBe(9);
		expect(SAME_BODY_EXCEPTIONS.size).toBe(0);
	});

	test("the real tree has no shared-helper drift", () => {
		const sources = repoSources();
		const declarations = sources.flatMap(declarationsOf);
		// A parser that stopped finding declarations would make the check vacuous.
		expect(declarations.filter((entry) => entry.surface === "lib").length).toBeGreaterThan(50);
		expect(declarations.filter((entry) => entry.surface === "extension").length).toBeGreaterThan(100);
		expect(declarations.filter((entry) => entry.surface === "script").length).toBeGreaterThan(20);
		expect(findViolations(sources)).toEqual([]);
	});

	const helperSettleFixture = `
export const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
`;

	test("fails a test that re-declares a helper by name", () => {
		const violations = findTestHelperCopies(
			[
				sourceOf(
					"extensions/a/x.test.ts",
					"const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));",
				),
			],
			[sourceOf("test/helpers/process.ts", helperSettleFixture)],
			new Map(),
		);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("re-declares a test helper; import settle from test/helpers/process.ts");
	});

	test("fails a renamed copy of a helper body", () => {
		const violations = findTestHelperCopies(
			[sourceOf("extensions/a/x.test.ts", libFixture.replace("clip", "trim"))],
			[sourceOf("test/helpers/format.ts", libFixture)],
			new Map(),
		);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("copies test/helpers/format.ts:clip");
	});

	test("ignores a private helper declaration", () => {
		const violations = findTestHelperCopies(
			[
				sourceOf(
					"extensions/a/x.test.ts",
					"const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));",
				),
			],
			[sourceOf("test/helpers/process.ts", helperSettleFixture.replace("export const", "const"))],
			new Map(),
		);
		expect(violations).toEqual([]);
	});

	test("honours a reasoned test-helper exception", () => {
		const violations = findTestHelperCopies(
			[
				sourceOf(
					"extensions/a/x.test.ts",
					"const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));",
				),
			],
			[sourceOf("test/helpers/process.ts", helperSettleFixture)],
			new Map([["extensions/a/x.test.ts:settle", "a different timer shape"]]),
		);
		expect(violations).toEqual([]);
	});

	test("every test-helper exception names a declaration that still exists", () => {
		const known = new Set(
			testSources()
				.flatMap(declarationsOf)
				.map((entry) => `${entry.path}:${entry.name}`),
		);
		const missing = [...TEST_HELPER_EXCEPTIONS.keys()].filter((key) => !known.has(key));
		expect(missing, "delete the exception: the declaration it names is gone").toEqual([]);
	});

	test("the test-helper exception list has no room to grow", () => {
		expect(TEST_HELPER_EXCEPTIONS.size).toBe(3);
	});

	test("the suite has no test-helper drift", () => {
		const tests = testSources();
		const helpers = helperSources();
		const exported = helpers.flatMap(declarationsOf).filter((entry) => entry.exported);
		// A parser that stopped finding helpers or tests would make the check vacuous.
		expect(exported.length).toBeGreaterThan(50);
		expect(tests.flatMap(declarationsOf).length).toBeGreaterThan(200);
		expect(findTestHelperCopies(tests, helpers)).toEqual([]);
	});
});
