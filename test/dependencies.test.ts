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
