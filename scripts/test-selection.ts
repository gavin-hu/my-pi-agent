/**
 * Which test files a scope names (dev tooling).
 *
 * `bun run check --ext board` and `bun run check --changed` ask one question —
 * what should this run cover — so the answer lives here once, as a pure
 * function: no git, no spawn, no clock. `check.ts` is the command that asks.
 *
 * Two owners supply the facts. `test/suite-manifest.ts` is the one declaration
 * of every suite, so a scope reads the layout instead of keeping a second list;
 * `test/helpers/graph.ts` is the import walker the registration budget reads,
 * so "which suites reach this file" cannot disagree with "which modules an
 * entry evaluates".
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { cachedSpecifiers, resolveFile, staticGraph, staticSpecifiers } from "../test/helpers/graph.ts";
import {
	ASSET_SUITES,
	EXTENSION_SUITES,
	LIB_SUITES,
	SCRIPT_SUITES,
	declaredSuiteFiles,
} from "../test/suite-manifest.ts";

/** What a scope resolved to, and one line per group that put a file in it. */
export interface Selection {
	/** Test files to run, repo-relative and sorted. */
	tests: string[];
	/** Why each group is in the selection, in the order it was added. */
	reasons: string[];
}

/** The repository a scope is resolved in, and the package-level tests it holds. */
export interface Tree {
	root: string;
	/** `test/*.test.ts` — the cross-cutting sweeps, which a changed run always keeps. */
	packageTests: string[];
}

/**
 * A path whose change invalidates any suite: shared helpers, the suite manifest
 * itself, and the three files that decide what a test run even is. Sorting
 * these out is what keeps a selection from being quietly too narrow.
 */
const SHARED = [/^test\/helpers\//, /^test\/suite-manifest\.ts$/, /^package\.json$/, /^tsconfig\.json$/, /^bun\.lock$/];

const EXTENSION_PATH = /^extensions\/([^/]+)\//;
const LIB_PATH = /^lib\/([^/]+)(?:\/|$)/;
const SCRIPT_PATH = /^scripts\/([^/]+)\.ts$/;
const ASSET_PATH = /^assets\/([^/]+)\//;

/** A path relative to `root`, in posix form so the keys compare on every host. */
function relativeTo(root: string, file: string): string {
	return file.replaceAll("\\", "/").slice(root.replaceAll("\\", "/").length + 1);
}

/** The tree a scope is resolved in: its root, and the package-level tests under it. */
export function tree(root: string): Tree {
	const dir = join(root, "test");
	return {
		root,
		packageTests: readdirSync(dir)
			.filter((name) => name.endsWith(".test.ts"))
			.map((name) => `test/${name}`)
			.sort(),
	};
}

/**
 * The region a path belongs to — `ext:board`, `lib:tui`, `script:render-bench`,
 * `asset:cards` — or `undefined` for a path no suite is named after. A region is
 * the candidate set for a file the import graph cannot see, such as one that was
 * just deleted, just started being imported, or opened by name as asset data.
 */
export function regionOf(path: string): string | undefined {
	const script = SCRIPT_PATH.exec(path);
	if (script) return `script:${script[1]}`;
	const extension = EXTENSION_PATH.exec(path);
	if (extension) return `ext:${extension[1]}`;
	const asset = ASSET_PATH.exec(path);
	if (asset) return `asset:${asset[1]}`;
	const lib = LIB_PATH.exec(path);
	if (!lib) return undefined;
	return `lib:${lib[1].replace(/\.test\.ts$/, "").replace(/\.ts$/, "")}`;
}

/** The declared suites in one region. */
function suitesOfRegion(region: string): string[] {
	if (region.startsWith("asset:")) return [...(ASSET_SUITES[region.slice("asset:".length)] ?? [])];
	if (region.startsWith("ext:")) {
		const name = region.slice("ext:".length);
		return (EXTENSION_SUITES[name] ?? []).map((suite) => `extensions/${name}/${suite}.test.ts`);
	}
	if (region.startsWith("lib:")) {
		const area = region.slice("lib:".length);
		return LIB_SUITES.filter((suite) => suite === area || suite.startsWith(`${area}/`)).map(
			(suite) => `lib/${suite}.test.ts`,
		);
	}
	const stem = region.slice("script:".length);
	return SCRIPT_SUITES.includes(stem) ? [`scripts/${stem}.test.ts`] : [];
}

/** Every declared suite, by the repo-relative files its static imports reach. */
export function reachIndex(root: string): Map<string, string[]> {
	const index = new Map<string, string[]>();
	// One reader for the walk: every declared suite reaches the same shared modules, and each read
	// is a parse, so an index costs one parse per file rather than one per entry that reaches it.
	const read = cachedSpecifiers();
	for (const suite of declaredSuiteFiles()) {
		for (const file of staticGraph(join(root, suite), read)) {
			const relative = relativeTo(root, file);
			if (relative.startsWith("..")) continue;
			const suites = index.get(relative);
			if (suites) suites.push(suite);
			else index.set(relative, [suite]);
		}
	}
	return index;
}

/**
 * The gated git suites, derived from the tree: every suite that imports the gate.
 * A file outside the manifest can import it too, so the check reports on the files
 * it actually selected rather than on the manifest alone.
 */
export function gatedAmong(root: string, suites: readonly string[]): string[] {
	return suites.filter((suite) => importsGate(root, suite));
}

/** Whether one file imports `test/helpers/slow-suite.ts`, which is how a suite opts into the gate. */
function importsGate(root: string, file: string): boolean {
	return staticSpecifiers(join(root, file)).some((specifier) => {
		const target = resolveFile(join(root, file), specifier);
		return target !== null && relativeTo(root, target) === "test/helpers/slow-suite.ts";
	});
}

/** The gated git suites alone: the declared layout, filtered by the gate's own import. */
export function slowSuites(root: string): string[] {
	return gatedAmong(root, declaredSuiteFiles());
}

function selection(tests: Iterable<string>, reasons: string[]): Selection {
	return { tests: [...new Set(tests)].sort(), reasons };
}

function refuse(scope: string, unknown: readonly string[], known: readonly string[]): never {
	throw new Error(`--${scope} names no such ${scope}: ${unknown.join(", ")}; known: ${known.join(", ")}`);
}

/** The whole declared suite plus the package-level tests: what `bun run check` runs. */
export function selectAll(scope: Tree): Selection {
	return selection(
		[...declaredSuiteFiles(), ...scope.packageTests],
		[`whole suite > ${declaredSuiteFiles().length} declared suites, ${scope.packageTests.length} package-level`],
	);
}

/** One or more extensions' declared suites. */
export function selectExt(names: readonly string[]): Selection {
	const known = Object.keys(EXTENSION_SUITES).sort();
	const unknown = names.filter((name) => !known.includes(name));
	if (unknown.length > 0 || names.length === 0) refuse("ext", unknown.length > 0 ? unknown : ["(none)"], known);
	return selection(
		names.flatMap((name) => suitesOfRegion(`ext:${name}`)),
		names.map((name) => `ext:${name} > ${(EXTENSION_SUITES[name] ?? []).length} suites`),
	);
}

/** One or more `lib/` areas, by the suite stems the manifest declares under them. */
export function selectLib(names: readonly string[]): Selection {
	const areas = [...new Set(LIB_SUITES.map((suite) => suite.split("/")[0]))].sort();
	const unknown = names.filter((name) => !areas.includes(name));
	if (unknown.length > 0 || names.length === 0) refuse("lib", unknown.length > 0 ? unknown : ["(none)"], areas);
	return selection(
		names.flatMap((name) => suitesOfRegion(`lib:${name}`)),
		names.map((name) => `lib:${name} > ${suitesOfRegion(`lib:${name}`).length} suites`),
	);
}

/** The package-level tests alone. */
export function selectRoot(scope: Tree): Selection {
	return selection(scope.packageTests, [`package-level > ${scope.packageTests.length} files`]);
}

/** The gated git suites alone; `check.ts` turns the gate on for the run. */
export function selectSlow(root: string): Selection {
	const suites = slowSuites(root);
	return selection(suites, [`gated git suites > ${suites.length} files (PI_SLOW_TESTS=1)`]);
}

/**
 * Whether a changed path is asset data no suite declares: bytes something may
 * read by name, which no import edge and no region can point at.
 */
function unclaimedAsset(path: string): boolean {
	if (!path.startsWith("assets/")) return false;
	const region = regionOf(path);
	return region === undefined || suitesOfRegion(region).length === 0;
}

/**
 * The tests a change can reach. The package-level tests always run, because
 * they are the sweeps that read the tree rather than import a module; a shared
 * path widens the run to everything, and so does an asset no suite declares;
 * otherwise a changed file contributes the suites that import it and the suites
 * named after its region.
 */
export function selectChanged(scope: Tree, changed: readonly string[], index: Map<string, string[]>): Selection {
	const tests = new Set(scope.packageTests);
	const reasons = [`package-level > ${tests.size} files, always`];
	if (changed.length === 0) {
		reasons.push("no changed path > package-level tests only");
		return selection(tests, reasons);
	}
	const shared = changed.filter((path) => SHARED.some((pattern) => pattern.test(path))).sort();
	if (shared.length > 0) {
		return selection(selectAll(scope).tests, [`shared ground: ${shared.join(", ")} > every suite`]);
	}
	const unclaimed = changed.filter(unclaimedAsset).sort();
	if (unclaimed.length > 0) {
		return selection(selectAll(scope).tests, [`unclaimed asset: ${unclaimed.join(", ")} > every suite`]);
	}
	for (const path of [...changed].sort()) {
		const reached = index.get(path) ?? [];
		for (const suite of reached) tests.add(suite);
		if (reached.length > 0) reasons.push(`reached by ${path} > ${reached.length} suites`);
		const region = regionOf(path);
		const owned = region === undefined ? [] : suitesOfRegion(region);
		for (const suite of owned) tests.add(suite);
		if (owned.length > 0) reasons.push(`region ${region} > ${owned.length} suites`);
	}
	if (tests.size === scope.packageTests.length) reasons.push("no suite reaches these paths > package-level tests only");
	return selection(tests, reasons);
}
