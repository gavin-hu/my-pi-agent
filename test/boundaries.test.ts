/**
 * What a module may depend on, and what `lib/` may hold.
 *
 * An extension never imports another extension's modules: the shared piece belongs in `lib/`,
 * which is what the one shared helper rule is for. And a `lib/` module carries no module-level
 * state, because Pi loads each extension with its own module cache — a module variable here is
 * one copy per extension, not one shared value.
 */

import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { posix } from "./helpers/files.ts";
import { dirsOf, extensionsDir, filesIn, libDir, repo, sourceFiles, textOf } from "./helpers/scan.ts";

describe("extension boundaries", () => {
	/** A specifier from a static import/export, a side-effect import, or a dynamic import. */
	const MODULE_SPEC = /(?:\bfrom\b|\bimport\s*\(?)\s*["']([^"']+)["']/;

	test("an extension never imports another extension's modules", () => {
		const names = dirsOf(extensionsDir);
		const offenders: string[] = [];
		for (const name of names) {
			for (const file of filesIn(join(extensionsDir, name))) {
				if (!file.endsWith(".ts")) continue;
				const relative = file.slice(repo.length + 1);
				const dir = file.slice(0, file.lastIndexOf("/"));
				textOf(file)
					.split("\n")
					.forEach((line, index) => {
						const spec = MODULE_SPEC.exec(line)?.[1];
						if (spec === undefined || !spec.startsWith(".")) return;
						const target = posix(join(dir, spec));
						const owner = names.find((other) => other !== name && target.startsWith(`${extensionsDir}/${other}/`));
						if (owner !== undefined) {
							offenders.push(`${relative}:${index + 1}: imports extensions/${owner} (${spec}); share it through lib/`);
						}
					});
			}
		}
		expect(offenders).toEqual([]);
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
