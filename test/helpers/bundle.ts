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
 *   (`extensions/board/view/render.ts` splices five).
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
