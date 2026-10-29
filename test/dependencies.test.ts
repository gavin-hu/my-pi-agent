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
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
	createSourceFile,
	forEachChild,
	isExportDeclaration,
	isExternalModuleReference,
	isImportDeclaration,
	isImportEqualsDeclaration,
	isNamespaceImport,
	isStringLiteral,
	ScriptTarget,
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
const DEFERRED_FROM_REGISTRATION: Readonly<Record<string, string>> = {
	"extensions/plan/web.ts": "the browser review loads on /plan review, /plan share, or exit_plan_mode",
	"extensions/board/page.ts": "the board page loads on the first /board",
	"extensions/file-browse/transport/server.ts": "the browse server loads when /browse opens a page",
	"extensions/worktree/screen.ts": "the worktree screen loads in the TUI branch of /worktree",
	"extensions/bytefly/panel/tui.ts": "the panel screen loads in the TUI branch of /bytefly",
};

/**
 * The total static module evaluations the entries may have.
 *
 * Like `LONG_MODULES`, the bar may only fall: a feature that needs more modules
 * has to justify the raise here, and a deferral that lands lowers it.
 */
const MODULE_BUDGET = 870;

/** A repo-relative path with forward slashes, the form the maps use. */
function repoRelative(file: string): string {
	return relative(REPO, file).replaceAll("\\", "/");
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
			for (const [path, when] of Object.entries(DEFERRED_FROM_REGISTRATION)) {
				if (!graph.has(join(REPO, path))) continue;
				offenders.push(`${repoRelative(entry)} statically imports ${path}; ${when}`);
			}
		}
		expect(
			offenders,
			"load the module inside the command, handler, or TUI branch that needs it; a static import pays it on every start",
		).toEqual([]);
	});

	test("the registration graph stays inside its module budget", () => {
		const total = entrypoints().reduce((sum, entry) => sum + staticGraph(entry).size, 0);
		expect(total, "static module evaluations across every entry; MODULE_BUDGET may only fall").toBeLessThanOrEqual(
			MODULE_BUDGET,
		);
	});
});
