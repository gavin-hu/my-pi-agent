/**
 * Static checks for a served page's client bundle.
 *
 * A page's script is a string: the plan and board pages assemble theirs from fragments
 * that cross the boundary as source, so no compiler reads the result. Each failure below is
 * invisible to every other check, and each is a `ReferenceError` or a throw at the page's
 * first render with the whole suite green:
 *
 * - a fragment declares a helper and the page calls it, but the fragment's source never
 *   reached the bundle (`extensions/plan/web-blocks.ts`'s `applyView` was called in the
 *   page's script and absent from it);
 * - a fragment calls a helper with no arguments where it takes parameters, so the call
 *   reads fields off nothing (`renderFacts()` beside a four-argument declaration cost the
 *   review's refetch its banner, inside a `.catch` that swallowed the throw);
 * - a template rule is spliced by `__NAME__` replacement and one replacement is missing,
 *   so the served script carries the literal `__RUNTIME__` and dies where it is used
 *   (`extensions/board/view/render.ts` splices five);
 * - two fragments declare the same constant, which is one word with two spellings waiting
 *   to drift (`LANE_LABEL` in `render.ts` and `live.ts`);
 * - a helper is published on the shared namespace and nothing reads it, so a caller that
 *   went away leaves the body behind in a string no type checker sees (`board.laneLabel`);
 * - two fragments define one name with different bodies, so which helper a caller reaches is
 *   the order the fragments are concatenated (`stamp`, on every Team-tab age, before #512).
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
 * The names `bundle` calls with no arguments though it declares them with some, sorted.
 *
 * The third failure the string boundary hides: `renderFacts()` shipped beside
 * `function renderFacts(steps, comments, counters, entries)`, so the review's refetch
 * threw on its first line, a trailing `.catch` ate it, and the sentence that was supposed
 * to follow the repaint — the banner saying the plan changed on disk — never appeared.
 *
 * A bare call only: `deps.closeComposer()` reads a declaration on `deps`, which has a type
 * of its own, so the scan stays on the boundary that has none.
 */
export function argumentlessCalls(bundle: string, names: readonly string[]): string[] {
	return names
		.filter(
			(name) =>
				new RegExp(`function ${name}\\(`).test(bundle) &&
				!new RegExp(`function ${name}\\(\\)`).test(bundle) &&
				new RegExp(`(?<![\\w.$])${name}\\(\\s*\\)`).test(bundle),
		)
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
 * Names the bundle defines more than once with bodies that differ, sorted.
 *
 * One name, two bodies: which one a caller reaches is decided by the order `client.ts`
 * concatenates its fragments, so a helper moved two lines is a call answering from the other
 * body, and the frame prints `undefined` with every suite green (`stamp` did, on every Team-tab
 * age). Bodies are compared rather than counted, because one builder emitted per instance
 * repeats its own text: `keysDialogScript` is `dialogScript` called a second time, so a page
 * with two dialogs carries two copies of one body — one body in one source, which is the shape
 * the kit is allowed to have.
 *
 * Two definitions of one name *and* two publications of it is the same hazard with a shorter
 * fuse, so it needs no separate rule: those bodies differ, and this reports them.
 */
export function duplicateFunctions(bundle: string): string[] {
	const bodies = new Map<string, Set<string>>();
	for (const match of bundle.matchAll(/^[ \t]*function (\w+)\s*\(/gm)) {
		const name = match[1] ?? "";
		const body = normalizedBody(bodyAfter(bundle, (match.index ?? 0) + match[0].length));
		const seen = bodies.get(name) ?? new Set<string>();
		seen.add(body);
		bodies.set(name, seen);
	}
	return [...bodies.entries()]
		.filter(([, seen]) => seen.size > 1)
		.map(([name]) => name)
		.sort();
}

/**
 * The braced body after a declaration's parameter list, or nothing when it has none.
 *
 * A scan rather than a parser, so braces inside a quoted string or a `//` comment are text
 * rather than structure; declarations spliced as `String(fn)` sit at no indentation at all,
 * which is why the body cannot be taken by matching the declaration's own indent.
 *
 * The one reader of its kind: `test/spliced-bodies.test.ts` asks it for a function's body to
 * check what a spliced one may name, so it is exported rather than copied.
 */
export function bodyAfter(bundle: string, from: number): string {
	let depth = 0;
	let start = -1;
	for (let i = from; i < bundle.length; i++) {
		const char = bundle[i];
		if (char === '"' || char === "'" || char === "`") {
			i += 1;
			while (i < bundle.length && bundle[i] !== char) {
				if (bundle[i] === "\\") i += 1;
				i += 1;
			}
			continue;
		}
		if (char === "/" && bundle[i + 1] === "/") {
			const newline = bundle.indexOf("\n", i);
			if (newline < 0) return "";
			i = newline;
			continue;
		}
		if (char === "{") {
			if (start < 0) start = i;
			depth += 1;
			continue;
		}
		if (char !== "}") continue;
		depth -= 1;
		if (depth === 0) return start < 0 ? "" : bundle.slice(start, i + 1);
	}
	return "";
}

/** One body as a single line, so two copies compare equal whatever their whitespace. */
function normalizedBody(body: string): string {
	return body.replace(/\s+/g, " ").trim();
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
