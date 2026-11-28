/**
 * What a module may depend on, and what `lib/` may hold.
 *
 * An extension never imports another extension's modules: the shared piece belongs in `lib/`,
 * which is what the one shared helper rule is for. And a `lib/` module carries no module-level
 * state, because Pi loads each extension with its own module cache — a module variable here is
 * one copy per extension, not one shared value.
 *
 * The edges come from `graph.ts`'s `importEdges`, so a specifier inside a comment or a string is
 * not an import: the reader parses, it does not scan.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "./helpers/env.ts";
import { posixPath } from "./helpers/files.ts";
import { importEdges, resolveFile, staticSpecifiers } from "./helpers/graph.ts";
import { dirsOf, extensionsDir, filesIn, libDir, repo, sourceFiles, textOf } from "./helpers/scan.ts";

describe("extension boundaries", () => {
	test("an extension never imports another extension's modules", () => {
		const names = dirsOf(extensionsDir);
		const offenders: string[] = [];
		for (const name of names) {
			for (const file of filesIn(join(extensionsDir, name))) {
				if (!file.endsWith(".ts")) continue;
				const source = file.slice(repo.length + 1);
				for (const edge of importEdges(file)) {
					if (!edge.specifier.startsWith(".")) continue;
					const target = resolveFile(file, edge.specifier);
					if (target === null) continue;
					const owner = names.find(
						(other) => other !== name && posixPath(target).startsWith(`${extensionsDir}/${other}/`),
					);
					if (owner !== undefined) {
						offenders.push(
							`${source}:${edge.line}: imports extensions/${owner} (${edge.specifier}); share it through lib/`,
						);
					}
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe("the import reader", () => {
	test("counts a value, a type and a deferred import once each, and no prose at all", () => {
		// What the two gates used to miss: a line scan reddens on prose and cannot tell a type import
		// from a value one. One file, read once — three edges exist, the budget pays for only the
		// first, and neither the comment nor the string is an import in either answer.
		const dir = tempDir("import-edges-");
		const file = join(dir, "sample.ts");
		writeFileSync(
			file,
			[
				'// from "./http/index.ts" is prose, not an edge',
				"const text = 'from \"./tui/glyphs.ts\"';",
				'import { width } from "./rules.ts";',
				'import type { Card } from "./card.ts";',
				'const lazy = await import("./store.ts");',
				"void text; void width; void lazy;",
			].join("\n"),
		);
		expect(importEdges(file)).toEqual([
			{ line: 3, specifier: "./rules.ts", loadsValue: true },
			{ line: 4, specifier: "./card.ts", loadsValue: false },
			{ line: 5, specifier: "./store.ts", loadsValue: false },
		]);
		expect(staticSpecifiers(file)).toEqual(["./rules.ts"]);
	});
});

describe("lib value-only", () => {
	/**
	 * A module-scope `let` / `var`: unindented, so a `let` inside a function stays
	 * local to its closure, which is the only state `lib/` may hold.
	 */
	const MODULE_BINDING = /^(?:export\s+)?(?:let|var)\b/;
	/**
	 * The mutable containers state takes when it is not a `let`. `new Set(...)` is
	 * not here on purpose: a keyword table is data, and the one shape this bans is
	 * a container a module can add to while it lives.
	 */
	const MODULE_CONTAINER = /^(?:export\s+)?const\s+[A-Za-z_$][\w$]*[^=]*=\s*(?:new\s+(?:Map|WeakMap|Array)\b|\[\])/;

	test("lib/ keeps no module-level state", () => {
		// Pi loads each extension with its own module cache, so a module variable here
		// is one copy per extension, not one shared value. lib/README.md states it.
		const offenders: string[] = [];
		for (const file of sourceFiles(libDir)) {
			textOf(file)
				.split("\n")
				.forEach((line, index) => {
					if (MODULE_BINDING.test(line) || MODULE_CONTAINER.test(line)) {
						offenders.push(
							`${file.slice(repo.length + 1)}:${index + 1}: module-level state; carry it in the caller's closure`,
						);
					}
				});
		}
		expect(offenders).toEqual([]);
	});
});
