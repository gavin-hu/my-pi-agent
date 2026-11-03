/**
 * The static import graph: what an extension entry evaluates when Pi loads it.
 *
 * Pi imports each extension with its own module cache, so a shared `lib/` module
 * is evaluated once per importing entry — the graph is therefore counted per
 * entry, not per repository. Two owners read it: the registration budget in
 * `test/dependencies.test.ts`, and the reading `bun run bench:load` prints. A
 * walker each would be two answers to one question.
 *
 * A dynamic `import()` is deliberately not an edge: that is the deferral the
 * budget asks for, and counting it would make every correct deferral fail.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Node } from "typescript";
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
} from "typescript";
import { textOf } from "./scan.ts";

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
	const source = createSourceFile(file, textOf(file), ScriptTarget.Latest, true);
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
export function packageOf(specifier: string): string | null {
	if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
	if (specifier.startsWith("node:") || specifier.startsWith("bun:")) return null;
	const parts = specifier.split("/");
	if (specifier.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
	return parts[0] || null;
}

/** The file a relative specifier resolves to, or `null` when it is not a source file here. */
export function resolveFile(from: string, specifier: string): string | null {
	if (!specifier.startsWith(".")) return null;
	const base = resolve(dirname(from), specifier);
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return null;
}

/** A read of one module's static specifiers; `staticSpecifiers` is the one implementation. */
type SpecifierReader = (file: string) => string[];

/**
 * A reader that parses each module once, for a caller that walks many entries.
 *
 * Every entry a walk starts from reaches the same shared modules, and each read is a parse:
 * `reachIndex` (`scripts/test-selection.ts`) spent 19,513 reads over 946 files on this tree, and
 * that cost is what made its own suite ride bun's budget. The cache belongs to the caller rather
 * than the process, so a walk handed a file someone just wrote still sees it.
 */
export function cachedSpecifiers(read: SpecifierReader = staticSpecifiers): SpecifierReader {
	const cache = new Map<string, string[]>();
	return (file) => {
		const seen = cache.get(file);
		if (seen !== undefined) return seen;
		const specifiers = read(file);
		cache.set(file, specifiers);
		return specifiers;
	};
}

/** Every local module one entrypoint loads statically, its entry included. */
export function staticGraph(entry: string, read: SpecifierReader = staticSpecifiers): Set<string> {
	const seen = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.shift() as string;
		if (seen.has(file)) continue;
		seen.add(file);
		for (const specifier of read(file)) {
			const target = resolveFile(file, specifier);
			if (target !== null) queue.push(target);
		}
	}
	return seen;
}

/**
 * Every entrypoint on disk, sorted by extension name.
 *
 * This is the tree's shape rather than the package's claim; `manifestEntries`
 * reads the paths Pi is actually handed, which is the difference a reading cares
 * about.
 */
export function entrypoints(extensionsDir: string): string[] {
	return readdirSync(extensionsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(extensionsDir, entry.name, "index.ts")))
		.map((entry) => entry.name)
		.sort()
		.map((name) => join(extensionsDir, name, "index.ts"));
}

/** Every entry `package.json`'s `pi` manifest declares, resolved, in manifest order. */
export function manifestEntries(packageRoot: string): string[] {
	const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as {
		pi?: { extensions?: string[] };
	};
	return (manifest.pi?.extensions ?? []).map((path) => resolve(packageRoot, path));
}
