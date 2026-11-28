/**
 * The static import graph: what a module names, and what an entry evaluates.
 *
 * Pi imports each extension with its own module cache, so a shared `lib/` module
 * is evaluated once per importing entry — the graph is therefore counted per
 * entry, not per repository. One reader answers what a module imports,
 * `importEdges`, and four owners read it: the registration budget in
 * `test/dependencies.test.ts`, the extension-boundary gate, the layer gate, and
 * the reading `bun run bench:load` prints. A walker each would be four answers to
 * one question, and the one that drifts is the one nobody reads.
 *
 * The three questions are not the same question, which is why the reader carries
 * `loadsValue` rather than deciding for its callers: a dynamic `import()` is the
 * deferral the budget asks for and must not count as a load, while a boundary or a
 * layer violation is a dependency whether it is deferred or erased by `tsc`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Node } from "typescript";
import {
	createSourceFile,
	forEachChild,
	isCallExpression,
	isExportDeclaration,
	isExternalModuleReference,
	isImportDeclaration,
	isImportEqualsDeclaration,
	isNamespaceImport,
	isStringLiteral,
	ScriptTarget,
	SyntaxKind,
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
	return importEdges(file)
		.filter((edge) => edge.loadsValue)
		.map((edge) => edge.specifier);
}

/** One specifier a module names: where it is, what it says, and whether it loads a value. */
export interface ImportEdge {
	/** 1-based line of the declaration, or of the `import()` call. */
	line: number;
	/** The specifier as written: relative, a package, or a host built-in. */
	specifier: string;
	/**
	 * Whether importing the module loads a value through this edge. False for a type-only form and
	 * for a dynamic `import()`, which is the deferral the budget asks for; the gates count both,
	 * because a type or a deferral is still a dependency.
	 */
	loadsValue: boolean;
}

/**
 * Every specifier one module names, in source order: static imports, re-exports, `import =`
 * require, type-only forms, and a dynamic `import()` with a literal argument.
 *
 * Reported as written, because resolving is the caller's question: a gate asks whether a relative
 * path lands in a directory it forbids. `resolveFile` answers `null` for a path that is not there,
 * and a caller treats that as no edge rather than an empty one — `bun run check` runs `tsc`
 * before the suites, so a relative import that does not resolve cannot reach a gate.
 */
export function importEdges(file: string): ImportEdge[] {
	const source = createSourceFile(file, textOf(file), ScriptTarget.Latest, true);
	const found: ImportEdge[] = [];
	const lineOf = (node: Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
	const visit = (node: Node): void => {
		if (isImportDeclaration(node) || isExportDeclaration(node)) {
			const specifier = node.moduleSpecifier;
			if (specifier && isStringLiteral(specifier))
				found.push({ line: lineOf(node), specifier: specifier.text, loadsValue: bindsValue(node) });
		} else if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference)) {
			const expression = node.moduleReference.expression;
			if (isStringLiteral(expression)) found.push({ line: lineOf(node), specifier: expression.text, loadsValue: true });
		} else if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
			const argument = node.arguments[0];
			if (argument !== undefined && isStringLiteral(argument))
				found.push({ line: lineOf(node), specifier: argument.text, loadsValue: false });
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
 * Every entry a walk starts from reaches the same shared modules, and each read is a parse: one
 * walk of this tree spent 19,513 reads over 946 files, and that cost is why the cache exists. It
 * belongs to the caller rather than the process, so a walk handed a file someone just wrote still
 * sees it.
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
