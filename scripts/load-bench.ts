/**
 * Load benchmark (dev tooling).
 *
 * Pi imports each extension with its own module cache — `createJiti(…, { moduleCache: false })`
 * — so a shared `lib/` module is transformed and evaluated once *per importing entry*,
 * and the package's load cost is the sum of what each entry drags in. This script
 * asks two different questions about that cost, and keeps them apart:
 *
 * - **Deterministic, and gated:** how many local modules an entry statically
 *   evaluates, and which modules more than one entry evaluates. `test/helpers/graph.ts` walks
 *   the graph, `ENTRY_BUDGET` in `test/dependencies.test.ts` holds each entry's height, and
 *   `bun run check` fails the entry that crosses it. Nothing here gates on time.
 * - **Wall-clock, and read by a person:** what those modules cost to transform and
 *   evaluate. The host packages are warmed in the child first, because every
 *   session pays them once whatever this package does; the number that varies is
 *   the entry's own graph.
 *
 *   load-bench.ts              the tables above
 *   test/helpers/graph.ts      the walk both this and the gate read
 */

import { spawnSync } from "node:child_process";
import { join, relative, sep } from "node:path";
import { manifestEntries, packageOf, staticGraph, staticSpecifiers } from "../test/helpers/graph.ts";
import { printTable } from "./cli.ts";

/** Children per entry. Each pays the entry's graph once, so a repeat is a new process. */
const RUNS = 3;

/** One entry's static graph, and how much of it another entry pays again. */
export interface GraphRow {
	/** The extension's name, from its entry path. */
	name: string;
	/** The entry module Pi is handed. */
	entry: string;
	/** Local modules this entry evaluates at registration. */
	modules: number;
	/** How many of them are `lib/` — the shared modules each entry re-evaluates. */
	lib: number;
	/** How many another entry also reaches, so this is the duplication this entry adds. */
	shared: number;
}

/** How many of the most-shared modules the second table prints. */
export const SHARED_ROWS = 10;

/** One module more than one entry evaluates: the duplication, named. */
export interface SharedModule {
	/** Its path from the package root, posix-spelled — the form the docs quote. */
	file: string;
	/** How many entries evaluate it. */
	entries: number;
}

/** What the whole manifest evaluates, and how much of it is the same module twice. */
export interface Reading {
	rows: GraphRow[];
	/** Every entry's modules, added up — the evaluations one session pays. */
	evaluations: number;
	/** Distinct modules behind them. */
	unique: number;
	/**
	 * Every module more than one entry evaluates, most-shared first.
	 *
	 * The list is the same count the totals agree with — a module evaluated `k` times
	 * contributes `k - 1` to `evaluations - unique` — so the paragraph that names the hot
	 * modules quotes one reading rather than a second, hand-kept number.
	 */
	shared: SharedModule[];
}

/** The extension name an entry belongs to: `extensions/<name>/index.ts`. */
function nameOf(entry: string): string {
	const parts = entry.split(/[\\/]/);
	return parts[parts.length - 2] ?? entry;
}

/** What one entry evaluates, and the `lib/` and duplicated parts of it. */
function rowOf(entry: string, modules: Set<string>, packageRoot: string, times: ReadonlyMap<string, number>): GraphRow {
	const libDir = join(packageRoot, "lib");
	return {
		name: nameOf(entry),
		entry,
		modules: modules.size,
		lib: [...modules].filter((file) => file.startsWith(libDir)).length,
		shared: [...modules].filter((file) => (times.get(file) ?? 0) > 1).length,
	};
}

/** Every declared entry's graph, in manifest order, with the totals behind them. */
export function reading(packageRoot: string): Reading {
	const entries = manifestEntries(packageRoot);
	const graphs = entries.map((entry) => [entry, staticGraph(entry)] as const);
	// A module's count is how many entries evaluate it, which is what makes it duplication.
	const times = new Map<string, number>();
	const distinct = new Set<string>();
	let evaluations = 0;
	for (const [, graph] of graphs) {
		evaluations += graph.size;
		for (const file of graph) {
			times.set(file, (times.get(file) ?? 0) + 1);
			distinct.add(file);
		}
	}
	return {
		rows: graphs.map(([entry, graph]) => rowOf(entry, graph, packageRoot, times)),
		evaluations,
		unique: distinct.size,
		shared: sharedOf(times, packageRoot),
	};
}

/** A module's path from the package root, posix-spelled so it reads the same on every platform. */
function displayPath(packageRoot: string, file: string): string {
	return relative(packageRoot, file).split(sep).join("/");
}

/** The modules more than one entry evaluates, most-shared first. */
function sharedOf(times: ReadonlyMap<string, number>, packageRoot: string): SharedModule[] {
	return [...times.entries()]
		.filter(([, count]) => count > 1)
		.map(([file, entries]) => ({ file: displayPath(packageRoot, file), entries }))
		.sort((a, b) => b.entries - a.entries || a.file.localeCompare(b.file));
}

/**
 * The bare specifiers any entry imports, warmed before an entry is timed.
 *
 * They are the host packages — Pi has them loaded by the time an extension
 * registers — so charging them to one entry reports the host's cost as ours. The
 * set is the tree's, not one entry's: warming only what that entry imports leaves
 * an entry's own peers cold and swamps the reading with their load time.
 */
export function hostSpecifiers(packageRoot: string): string[] {
	const found = new Set<string>();
	for (const entry of manifestEntries(packageRoot)) {
		for (const file of staticGraph(entry)) {
			for (const specifier of staticSpecifiers(file)) {
				if (packageOf(specifier) !== null) found.add(specifier);
			}
		}
	}
	return [...found].sort();
}

/** A child that warms the host packages, then times only the entry's own import. */
function probe(entry: string, hosts: readonly string[]): string {
	return [
		`for (const spec of ${JSON.stringify(hosts)}) await import(spec);`,
		"const started = performance.now();",
		`await import(${JSON.stringify(entry)});`,
		"process.stdout.write(String(performance.now() - started));",
	].join("\n");
}

/**
 * What one entry's graph costs to transform and evaluate, in milliseconds, or
 * `undefined` when every child failed.
 *
 * Indicative by construction: it depends on the machine, on the runtime's
 * transform cache, and on the loader, so it is compared with the budget in
 * `CONTRIBUTING.md` and never asserted in a test.
 */
export function importMs(packageRoot: string, entry: string, hosts: readonly string[]): number | undefined {
	const source = probe(entry, hosts);
	const runs: number[] = [];
	for (let index = 0; index < RUNS; index++) {
		const child = spawnSync(process.execPath, ["-e", source], { cwd: packageRoot, encoding: "utf8" });
		const ms = Number(child.stdout);
		if (child.status === 0 && Number.isFinite(ms)) runs.push(ms);
	}
	return runs.length === 0 ? undefined : Math.min(...runs);
}

/** `bun run bench:load` */
if (import.meta.main) {
	const root = join(import.meta.dir, "..");
	const { rows, evaluations, unique, shared } = reading(root);
	const hosts = hostSpecifiers(root);
	// Most expensive first: the reading is for finding the entry that grew.
	const timed = rows
		.map((row) => ({ ...row, ms: importMs(root, row.entry, hosts) }))
		.sort((a, b) => b.modules - a.modules || a.name.localeCompare(b.name));
	printTable(
		["entry", "modules", "lib", "shared", "import", "per module"],
		timed.map((row) => [
			row.name,
			String(row.modules),
			String(row.lib),
			String(row.shared),
			row.ms === undefined ? "?" : `${row.ms.toFixed(1)}ms`,
			row.ms === undefined ? "?" : `${(row.ms / row.modules).toFixed(2)}ms`,
		]),
	);

	console.log("");
	console.log(
		`${rows.length} entries · ${evaluations} static evaluations over ${unique} unique modules (×${(evaluations / unique).toFixed(2)})`,
	);
	console.log(`host packages warmed before each entry · ${RUNS} runs, fastest`);

	// Third block: the duplication, named. The totals above say how much of it there is; this
	// says which modules it is, so a sentence that quotes one (`lib/env.ts` by every entry)
	// can be checked against the same run rather than kept by hand beside it.
	console.log("");
	printTable(
		["module", "entries"],
		shared.slice(0, SHARED_ROWS).map((module) => [module.file, String(module.entries)]),
	);
	if (shared.length > SHARED_ROWS) console.log(`… and ${shared.length - SHARED_ROWS} more shared modules`);

	// The gate's own failure mode: a walker that resolved nothing would print a
	// table of zeroes and read as a cheap package.
	const unresolved = rows.filter((row) => row.modules === 0);
	if (unresolved.length > 0) {
		console.error(`\nNo modules resolved for: ${unresolved.map((row) => row.name).join(", ")}`);
		process.exit(1);
	}
}
