/**
 * The kit's class names, as a page writes them.
 *
 * A served page states a class in a string no type checker reads — markup, a template literal, a
 * client bundle spliced into the document — so a kit rename leaves the old word behind and the
 * control draws with no rule at all while every suite stays green. `test/web-classes.test.ts` is the
 * rule that catches it; these are the two reads every caller shares, so the page-scoped cases and
 * the root guard agree about what a page writes.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The `bf-*` names one page writes, sorted and deduplicated: a kit class in markup and one in a
 * script are the same claim.
 *
 * A name built at runtime appears as its literal head — `" bf-tone--" + tone` reads `bf-tone` — which
 * is why a caller may name a family rather than an exact class; see the guard's table.
 */
export function kitNamesIn(source: string): string[] {
	return [...new Set(source.match(/\bbf-[a-z0-9]+(?:[-_]{1,2}[a-z0-9]+)*/g) ?? [])].sort();
}

/** Every non-test source under `dir`, joined: one page's markup, scripts and fragments as one text. */
export function sourcesUnder(dir: string, skip: readonly string[] = []): string {
	return readdirSync(dir)
		.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !skip.includes(file))
		.map((file) => readFileSync(join(dir, file), "utf-8"))
		.join("\n");
}

/**
 * Whether `css` rules a class with this exact name.
 *
 * Exact and not a substring: `.bf-tone` is not ruled by `.bf-tone--danger`, and letting the
 * substring answer was the luck this guard exists to remove.
 */
export function rulesClass(css: string, name: string): boolean {
	return new RegExp(`\\.${escape(name)}(?![-_a-z0-9])`).test(css);
}

/** A name used in a pattern is not one to interpret: `.` and `-` are ordinary here. */
function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
