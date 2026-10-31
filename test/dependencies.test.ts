/**
 * The dependency budget: a runtime dependency must not load when an extension
 * registers.
 *
 * The package ships eight parser and image libraries as ordinary `dependencies`,
 * and the extension entrypoint is what Pi calls on every start. A dependency
 * imported at module scope is therefore paid on every session, whether or not
 * the feature is used; the house pattern is a dynamic `import()` inside the
 * function that needs it (`extract/xlsx.ts`, `lib/pdf.ts`). This walks each
 * entrypoint's **static** import graph and fails on a `dependencies` package,
 * with the chain that reaches it. A dynamic `import()` ends the walk, because
 * that is exactly the deferral the rule asks for.
 *
 * A genuine exception names its reason in `REGISTRATION_LOAD`; the map is empty
 * today, which is the honest state after the fixes this check found.
 *
 * The other half of a deferral is the contract: a module that reaches another through
 * `import()` may not re-declare a type that module exports. A facade cannot import a
 * value without loading it, so it restates — `review-lazy.ts` carried copies of
 * `review.ts`'s decision types until they drifted — while a *type* import is erased and
 * costs the registration path nothing. `restatedTypes` holds that half.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
	createSourceFile,
	forEachChild,
	isCallExpression,
	isExportDeclaration,
	isExternalModuleReference,
	isImportDeclaration,
	isImportEqualsDeclaration,
	isInterfaceDeclaration,
	isNamespaceImport,
	isStringLiteral,
	isTypeAliasDeclaration,
	ScriptTarget,
	SyntaxKind,
	type Node,
} from "typescript";
import { tempDir } from "./helpers/env.ts";

const REPO = join(import.meta.dir, "..");

interface PackageJson {
	dependencies?: Record<string, string>;
}

const PACKAGE = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as PackageJson;
const DEPENDENCIES = new Set(Object.keys(PACKAGE.dependencies ?? {}));

/**
 * A dependency allowed to load at registration, with the reason it must.
 *
 * The door is here rather than an exclude list in the scan: a reason is the price
 * of entry, so a new exception is a deliberate, reviewable sentence.
 */
const REGISTRATION_LOAD: Readonly<Record<string, string>> = {};

/** Whether an import or re-export loads a runtime value (a bare `import "x"` does). */
function bindsValue(node: Node): boolean {
	if (isExportDeclaration(node)) return !node.isTypeOnly;
	if (!isImportDeclaration(node)) return true;
	const clause = node.importClause;
	if (!clause) return true;
	if (clause.isTypeOnly) return false;
	if (clause.name) return true;
	const named = clause.namedBindings;
	if (!named) return false;
	if (isNamespaceImport(named)) return true;
	return named.elements.some((element) => !element.isTypeOnly);
}

/**
 * The specifiers one module loads at import time.
 *
 * `import`, `export … from`, and `import x = require("y")` are all static; a
 * dynamic `import()` is a call expression and is deliberately not collected.
 */
export function staticSpecifiers(file: string): string[] {
	const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
	const found: string[] = [];
	const visit = (node: Node): void => {
		if (isImportDeclaration(node) || isExportDeclaration(node)) {
			const specifier = node.moduleSpecifier;
			if (specifier && isStringLiteral(specifier) && bindsValue(node)) found.push(specifier.text);
		} else if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference)) {
			const expression = node.moduleReference.expression;
			if (isStringLiteral(expression)) found.push(expression.text);
		}
		forEachChild(node, visit);
	};
	forEachChild(source, visit);
	return found;
}

/** The package a bare specifier names, or `null` for a path or a host built-in. */
function packageOf(specifier: string): string | null {
	if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
	if (specifier.startsWith("node:") || specifier.startsWith("bun:")) return null;
	const parts = specifier.split("/");
	if (specifier.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
	return parts[0] || null;
}

/** The file a relative specifier resolves to, or `null` when it is not a source file here. */
function resolveFile(from: string, specifier: string): string | null {
	if (!specifier.startsWith(".")) return null;
	const base = resolve(dirname(from), specifier);
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return null;
}

/**
 * The local modules one file defers through a literal `import()`.
 *
 * A deferral is the fix the rule above asks for, and it is also why a facade restates
 * what it cannot statically import: `review-lazy.ts` declared `review.ts`'s types twice
 * over. A computed specifier, or a thunk passed in from elsewhere, has no edge here.
 */
function deferredTargets(file: string): string[] {
	const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
	const found: string[] = [];
	const visit = (node: Node): void => {
		if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
			const [specifier] = node.arguments;
			if (specifier && isStringLiteral(specifier)) {
				const target = resolveFile(file, specifier.text);
				if (target !== null) found.push(target);
			}
		}
		forEachChild(node, visit);
	};
	forEachChild(source, visit);
	return found;
}

/** The names a module exports as a type: an `interface`, or a `type` alias. */
function exportedTypes(file: string): string[] {
	const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true);
	const found: string[] = [];
	for (const statement of source.statements) {
		if (!isInterfaceDeclaration(statement) && !isTypeAliasDeclaration(statement)) continue;
		const exported = statement.modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword);
		if (exported !== true || statement.name === undefined) continue;
		found.push(statement.name.text);
	}
	return found;
}

/** How many deferral edges the tree has, so a walker that stopped resolving cannot pass. */
export function deferralEdges(files: readonly string[]): number {
	return files.reduce((total, file) => total + deferredTargets(file).length, 0);
}

/**
 * Rule 5: a module that defers another may not re-declare a type that module exports.
 *
 * A facade cannot import a value without loading it, so it restates — `review-lazy.ts`
 * carried copies of `review.ts`'s decision types, and they had already drifted apart. A
 * *type* import is erased, so naming the contract costs nothing and the copy is the only
 * thing that can go wrong.
 */
export function restatedTypes(files: readonly string[]): string[] {
	const types = new Map(files.map((file) => [file, exportedTypes(file)]));
	const violations: string[] = [];
	for (const file of files) {
		const mine = types.get(file) ?? [];
		if (mine.length === 0) continue;
		for (const target of deferredTargets(file)) {
			const theirs = new Set(types.get(target) ?? []);
			for (const name of mine) {
				if (!theirs.has(name)) continue;
				violations.push(
					`${repoRelative(file)}:${name} re-declares ${repoRelative(target)}:${name}; name it with an import type instead`,
				);
			}
		}
	}
	return [...new Set(violations)].sort();
}

/** A readable chain from the entrypoint to the module that made the import. */
function chainOf(parents: ReadonlyMap<string, string>, file: string): string {
	const walked = [file];
	let current = parents.get(file);
	while (current !== undefined) {
		walked.unshift(current);
		current = parents.get(current);
	}
	return walked.map((step) => relative(REPO, step)).join(" → ");
}

/** Every extension entrypoint. */
function entrypoints(): string[] {
	return readdirSync(join(REPO, "extensions"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(REPO, "extensions", entry.name, "index.ts")))
		.map((entry) => join(REPO, "extensions", entry.name, "index.ts"));
}

/** Each dependency one entrypoint loads at registration, with the chain that reaches it. */
function registrationLoads(entry: string): string[] {
	const parents = new Map<string, string>();
	const queue = [entry];
	const found: string[] = [];
	while (queue.length > 0) {
		const file = queue.shift() as string;
		for (const specifier of staticSpecifiers(file)) {
			const pkg = packageOf(specifier);
			if (pkg !== null && DEPENDENCIES.has(pkg) && !(pkg in REGISTRATION_LOAD)) {
				found.push(`${chainOf(parents, file)} imports "${pkg}"`);
				continue;
			}
			if (pkg !== null) continue;
			const target = resolveFile(file, specifier);
			if (target !== null && !parents.has(target)) {
				parents.set(target, file);
				queue.push(target);
			}
		}
	}
	return found;
}

describe("dependency budget", () => {
	test("no runtime dependency loads when an extension registers", () => {
		const loads = [...new Set(entrypoints().flatMap(registrationLoads))].sort();
		expect(
			loads,
			"load the package inside the function that needs it (the extract/xlsx.ts pattern), or name a reason in REGISTRATION_LOAD",
		).toEqual([]);
	});

	test("the scan tells a static import from a dynamic one", () => {
		// The guard is only as good as this distinction: a dynamic import is the fix,
		// so counting it as a load would make every correct deferral fail.
		const dir = tempDir("dep-scan-");
		const file = join(dir, "sample.ts");
		writeFileSync(
			file,
			[
				'import value from "static-default";',
				'import { named } from "static-named";',
				'import type { Shape } from "type-only";',
				'import { type Only } from "type-named";',
				'import mixed, { type Also } from "mixed";',
				'import "side-effect";',
				'export * from "reexported";',
				'export type { Gone } from "type-reexport";',
				'const lazy = await import("dynamic");',
				"void lazy; void value; void named; void mixed;",
			].join("\n"),
		);
		expect(staticSpecifiers(file).sort()).toEqual([
			"mixed",
			"reexported",
			"side-effect",
			"static-default",
			"static-named",
		]);
	});
});

/**
 * A surface that loads on first use, with the sentence that says when.
 *
 * The entry modules are what Pi calls on every start, so a static import here is
 * the regression: the feature is registered, but its page, server, or screen is
 * not needed until a command or a TUI branch asks for it.
 */
/**
 * The surfaces a rule keeps out, rather than a list that keeps growing.
 *
 * A full-screen surface lives under `view/` — the `wechat` doc's "`view/` draws a
 * full-screen surface" is the same rule — and the served-page kit (`lib/http/`,
 * `mount.ts` excepted) is only reachable from one. Filing a screen under `view/`
 * is therefore what makes it lazy; there is no row to remember.
 */
const DEFERRED_BY_RULE: readonly RegExp[] = [
	/^extensions\/[^/]+\/view\/[^/]+\.ts$/,
	/^lib\/http\/(?!mount\.ts$)[^/]+\.ts$/,
];

/** Whether a repo-relative module is one the rules keep off the registration path. */
function deferredByRule(path: string): boolean {
	return DEFERRED_BY_RULE.some((rule) => rule.test(path));
}

/** Why a rule-matched module is deferred, for the failure message. */
function ruleOf(path: string): string {
	return path.startsWith("lib/http/")
		? "the served-page kit loads when a page is served, never at registration"
		: "a full-screen surface loads in the TUI branch that opens it";
}

/**
 * The deferrals a rule cannot express, each with the sentence that says when it loads.
 *
 * A row here is an exception to `DEFERRED_BY_RULE`'s filing rule: a module that is
 * not a screen but still must not be paid at start.
 */
const DEFERRED_FROM_REGISTRATION: Readonly<Record<string, string>> = {
	"extensions/wechat/bridge.ts": "the bridge loads when an account is stored",
	"extensions/plan/web.ts": "the browser review loads on /plan review, /plan share, or the plan tool's exit action",
	"extensions/plan/review.ts": "the review gate and its TUI screen load on the first /plan review or plan exit",
	"extensions/plan/git-bash.ts": "the read-only git check loads when plan mode vets a bash call",
	"extensions/plan/path-guard.ts": "the path backstop loads when plan mode vets a tool call",
	"extensions/board/page.ts": "the board page loads on the first /board",
	"extensions/file-browse/transport/server.ts": "the browse server loads when /browse opens a page",
	"extensions/file-browse/config/config.ts": "the browse config loads when /browse opens a page",
	"extensions/file-browse/files/paths.ts": "the browse path guard loads when /browse resolves or serves a path",
	"extensions/file-browse/git/git.ts": "the browse status and diff load when /browse opens a page",
	"extensions/worktree/screen.ts": "the worktree screen loads in the TUI branch of /worktree",
	"extensions/bytefly/panel/tui.ts": "the panel screen loads in the TUI branch of /bytefly",
	"extensions/bytefly/panel/settings-runtime.ts":
		"the settings runtime loads when /bytefly opens settings or the panel",
	"extensions/bytefly/picker/discovery.ts": "resource discovery loads when /bytefly lists or opens the panel",
	"extensions/bytefly/picker/runtime.ts": "the picker runtime loads when /bytefly opens its panel or a listing",
	"extensions/bytefly/panel/skills.ts": "the skill lookup loads when /bytefly lists skills or opens the panel",
};

/**
 * The total static module evaluations the entries may have.
 *
 * Like `LONG_MODULES`, the bar may only fall: a feature that needs more modules
 * has to justify the raise here, and a deferral that lands lowers it.
 *
 * 727 → 733: the board's `bytefly.json` section became one module (`board/config.ts`, read by
 * `board` and by `team` through the store) and the signer rule another (`board/lead.ts`), so the
 * two entries that load the board's rules load two more modules each; then the page's seat
 * (`board/seat.ts`) became `lib/`, which the settings screen loads too, since the lead's default
 * is that seat. Nothing was deferred.
 *
 * 733 → 734: folding `plan` into one action tool adds one, and defers none — `tools/refusal.ts`
 * is the one rejected-call shape five actions share. `worktree`'s folded tool draws
 * bytefly's generic fallback, exactly as its four tools did, so no transcript kit joins its
 * registration graph for cosmetics.
 *
 * 734 → 737: `job`'s 1017-line runtime became three modules of one responsibility — the table,
 * `child.ts` (a job's process and its output) and `clock.ts` (the repaint clock and the
 * reattached-job sweep) — and the last of the three brings `lib/child.ts` with it, which is the
 * module both extensions now spawn through. Nothing is deferred: the three are the split, and
 * every one of them is what the old single module already evaluated, spread differently.
 */
const MODULE_BUDGET = 737;

/** A repo-relative path with forward slashes, the form the maps use. */
function repoRelative(file: string): string {
	return relative(REPO, file).replaceAll("\\", "/");
}

/** Every `.ts` module under `extensions/` and `lib/`, for the rule and map checks. */
function everySourceFile(): string[] {
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) found.push(path);
		}
	};
	for (const dir of ["extensions", "lib"]) walk(join(REPO, dir));
	return found;
}

/** Every local module one entrypoint loads statically, its entry included. */
function staticGraph(entry: string): Set<string> {
	const seen = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.shift() as string;
		if (seen.has(file)) continue;
		seen.add(file);
		for (const specifier of staticSpecifiers(file)) {
			const target = resolveFile(file, specifier);
			if (target !== null) queue.push(target);
		}
	}
	return seen;
}

describe("registration module budget", () => {
	test("the deferred surfaces do not load when an extension registers", () => {
		const offenders: string[] = [];
		for (const entry of entrypoints()) {
			const graph = staticGraph(entry);
			const reached = new Set([...graph].map(repoRelative));
			for (const path of reached) {
				if (deferredByRule(path)) offenders.push(`${repoRelative(entry)} statically imports ${path}; ${ruleOf(path)}`);
			}
			for (const [path, when] of Object.entries(DEFERRED_FROM_REGISTRATION)) {
				if (!reached.has(path)) continue;
				offenders.push(`${repoRelative(entry)} statically imports ${path}; ${when}`);
			}
		}
		expect(
			offenders,
			"load the module inside the command, handler, or TUI branch that needs it; a static import pays it on every start",
		).toEqual([]);
	});

	test("the deferral map carries no stale entry", () => {
		const stale = Object.keys(DEFERRED_FROM_REGISTRATION).filter((path) => !existsSync(join(REPO, path)));
		expect(stale, "drop the row, or restore the module it names").toEqual([]);
	});

	test("every rule still names a module on disk", () => {
		// A rule that matches nothing has quietly stopped applying, the same failure
		// mode `LONG_MODULES`' stale-entry test covers.
		const files = everySourceFile().map(repoRelative);
		const dead = DEFERRED_BY_RULE.filter((rule) => !files.some((file) => rule.test(file)));
		expect(dead.map(String), "a rule that matches nothing has stopped applying; fix it or drop it").toEqual([]);
	});

	test("the registration graph stays inside its module budget", () => {
		const total = entrypoints().reduce((sum, entry) => sum + staticGraph(entry).size, 0);
		expect(total, "static module evaluations across every entry; MODULE_BUDGET may only fall").toBeLessThanOrEqual(
			MODULE_BUDGET,
		);
	});
});

describe("deferred contracts", () => {
	test("a module that defers to another restates none of its types", () => {
		const files = everySourceFile();
		// A walker that stopped resolving `import()` would leave both checks below vacuous.
		expect(deferralEdges(files), "the tree defers tens of modules").toBeGreaterThan(20);
		expect(
			restatedTypes(files),
			"import the type from the module the facade defers to; a type import is erased, so it costs the registration path nothing",
		).toEqual([]);
	});

	test("the check tells a restated type from an imported one", () => {
		const dir = tempDir("deferral-");
		const impl = join(dir, "impl.ts");
		const facade = join(dir, "facade.ts");
		writeFileSync(impl, "export interface Choice { action: string }\nexport type Decision = { ok: boolean };\n");
		// The facade restates one type and names the other, which is the whole rule.
		writeFileSync(
			facade,
			[
				'import type { Choice } from "./impl.ts";',
				"export type Decision = { ok: boolean };",
				'export const load = (): Promise<unknown> => import("./impl.ts");',
				"export type Loaded = Choice | Decision;",
			].join("\n"),
		);

		const violations = restatedTypes([impl, facade]);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("facade.ts:Decision re-declares");
		expect(violations[0]).toContain("impl.ts:Decision");
		expect(deferralEdges([impl, facade])).toBe(1);

		// The fix is what the real tree does: the facade names the type and declares none.
		writeFileSync(
			facade,
			[
				'import type { Choice, Decision } from "./impl.ts";',
				'export const load = (): Promise<unknown> => import("./impl.ts");',
				"export type Loaded = Choice | Decision;",
			].join("\n"),
		);
		expect(restatedTypes([impl, facade])).toEqual([]);
	});
});
