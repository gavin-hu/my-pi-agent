/**
 * Static checks for a served page's client bundle.
 *
 * A page's script is a string: the plan and board pages assemble theirs from fragments
 * that cross the boundary as source, so no compiler reads the result. Two failures are
 * invisible to every other check, and both are `ReferenceError`s at the page's first
 * render with the whole suite green:
 *
 * - a fragment declares a helper and the page calls it, but the fragment's source never
 *   reached the bundle (`extensions/plan/web-blocks.ts`'s `applyView` was called in the
 *   page's script and absent from it);
 * - a template rule is spliced by `__NAME__` replacement and one replacement is missing,
 *   so the served script carries the literal `__RUNTIME__` and dies where it is used
 *   (`extensions/board/view/render.ts` splices five);
 * - two fragments declare the same constant, which is one word with two spellings waiting
 *   to drift (`LANE_LABEL` in `render.ts` and `live.ts`);
 * - a helper is published on the shared namespace and nothing reads it, so a caller that
 *   went away leaves the body behind in a string no type checker sees (`board.laneLabel`).
 *
 * Both sides are read from source, not from imports: the failure is a function that exists
 * in a module and never reached the string, so the module's own text is the only complete
 * list of what could have been spliced.
 *
 * `file-browse` is not covered, and does not need to be: its fragments are the string
 * bodies themselves — one template per module, no function source and no placeholder — so
 * the identifiers are the page's own and its compile check plus the browser suite see
 * everything a static scan could.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A `.ts` source the scan reads: the path, and its text. */
interface Source {
	path: string;
	text: string;
}

function sourcesIn(directory: string, filePattern: RegExp): Source[] {
	const sources: Source[] = [];
	for (const file of readdirSync(directory)) {
		if (file.endsWith(".test.ts") || !filePattern.test(file)) continue;
		sources.push({ path: join(directory, file), text: readFileSync(join(directory, file), "utf-8") });
	}
	return sources;
}

/**
 * Every function the given modules declare, by name.
 *
 * Top-level `function name(` declarations only: a fragment that crosses as source is
 * written as a declaration, because `String(fn)` of an arrow keeps its name but a method
 * does not.
 */
export function declaredFunctions(directory: string, filePattern: RegExp): string[] {
	const names = new Set<string>();
	for (const source of sourcesIn(directory, filePattern)) {
		for (const match of source.text.matchAll(/^(?:export )?function (\w+)/gm)) names.add(match[1] ?? "");
	}
	return [...names].filter((name) => name !== "");
}

/**
 * The names `bundle` calls without a body in it, sorted.
 *
 * A call is `name(`; a body is `function name(`. A name the bundle never mentions is not
 * reported — a fragment may hold a helper only the terminal uses.
 */
export function missingBundleBodies(bundle: string, names: readonly string[]): string[] {
	return names
		.filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(bundle) && !bundle.includes(`function ${name}(`))
		.sort();
}

/**
 * The `__NAME__` template rules left unfilled in `bundle`, sorted.
 *
 * The uppercase shape is the one the pages splice with, so a served script carrying one is
 * a missing `.replace` rather than prose.
 */
export function unfilledPlaceholders(bundle: string): string[] {
	return [...new Set(bundle.match(/__[A-Z][A-Z0-9_]*__/g) ?? [])].sort();
}

/**
 * Top-level `var NAME =` declarations that `bundle` states more than once, sorted.
 *
 * A page's fragments share one namespace and no import graph, so a constant two fragments
 * both need is either declared once and published on the shared object, or declared twice.
 * Two declarations are two spellings: `LANE_LABEL` shipped twice, and the lane head and
 * the card dialog could have drifted a word apart. Uppercase and one indent only — a `var`
 * inside a function is a local, and repeats by design.
 */
export function duplicateDeclarations(bundle: string): string[] {
	const counts = new Map<string, number>();
	for (const match of bundle.matchAll(/^ {2}var ([A-Z][A-Z0-9_]*) =/gm)) {
		const name = match[1] ?? "";
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([name]) => name)
		.sort();
}

/**
 * The names `bundle` publishes on its own namespace that nothing else in it reads, sorted.
 *
 * `board.laneLabel = …` with no `board.laneLabel(` anywhere is a helper that outlived its
 * caller, and a string no type checker reads keeps it forever. The publication is itself
 * one mention, so a name that works has to appear twice.
 */
export function unreadPublications(bundle: string, namespace = "board"): string[] {
	const published = new Set<string>();
	for (const match of bundle.matchAll(new RegExp(`\\b${namespace}\\.(\\w+)\\s*=(?!=)`, "g"))) {
		published.add(match[1] ?? "");
	}
	return [...published]
		.filter((name) => (bundle.match(new RegExp(`\\b${namespace}\\.${name}\\b`, "g")) ?? []).length < 2)
		.sort();
}
