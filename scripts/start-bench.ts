/**
 * Startup benchmark (dev tooling).
 *
 * `bun run bench:load` reads one entry's graph in isolation, warm, and gates its size; a
 * start pays every entry in one cold process, and a `/reload` pays it again — Pi's loader
 * clears the extension cache before reloading. This script asks the host what that costs:
 * `PI_TIMING=1` makes Pi print each extension's `module import` and `factory` milliseconds
 * on stderr, and `--mode rpc` with its stdin closed prints them and exits without a model
 * call. The numbers are a pre-release reading on this machine; nothing here gates on time.
 *
 *   load-bench.ts    the graph, counted and gated per entry
 *   start-bench.ts   what that graph costs a start to import
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ALL_EXTENSIONS_ENV, tempDir } from "../test/helpers/env.ts";
import { printTable } from "./cli.ts";
import { reading } from "./load-bench.ts";

/** Runs per reading; the middle total is the one printed. Each run is a cold child process. */
const RUNS = 3;

/** A child that never answers is a broken host, not a slow one. */
const CHILD_TIMEOUT_MS = 120_000;

/** One `label: Nms` line inside a timing group. */
export interface TimingRow {
	label: string;
	ms: number;
}

/** The two groups Pi prints: its own startup, and the extension loader's. */
export interface TimingGroups {
	main: TimingRow[];
	extensions: TimingRow[];
}

const SECTION = /^--- Startup Timings: (.+) ---$/;
const ROW = /^ {2}(.+): (-?\d+)ms$/;

/**
 * Read `PI_TIMING=1`'s stderr into its groups.
 *
 * The format is the host's, so this is deliberately narrow: a section header starts a
 * group, two-space `label: Nms` lines are its rows, and `TOTAL` is not a row. Anything
 * else — the TUI's writes, a warning — is ignored.
 */
export function parseTimings(text: string): TimingGroups {
	const groups: TimingGroups = { main: [], extensions: [] };
	let current: TimingRow[] | undefined;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/\s+$/, "");
		const section = SECTION.exec(line);
		if (section) {
			current = section[1] === "main" ? groups.main : section[1] === "extensions" ? groups.extensions : undefined;
			continue;
		}
		if (current === undefined) continue;
		const row = ROW.exec(line);
		if (row === null || row[1] === "TOTAL") continue;
		current.push({ label: row[1], ms: Number(row[2]) });
	}
	return groups;
}

/** One entry's cost in a start. */
export interface EntryRow {
	/** The extension's name, from its entry path. */
	name: string;
	/** The entry module Pi is handed. */
	entry: string;
	/** Local modules its registration graph evaluates, from `bench:load`'s walk. */
	modules: number;
	/** Milliseconds its graph took to transform and evaluate, cold. */
	importMs: number;
	/** Milliseconds its factory took to register. */
	factoryMs: number;
}

/** A whole start: every entry, and the two namespaces behind them. */
export interface StartReading {
	rows: EntryRow[];
	importMs: number;
	factoryMs: number;
	mainMs: number;
	/** Entries Pi printed no timing for — a renamed label, or an extension that failed to load. */
	missing: string[];
}

/** The milliseconds one label took, or `undefined` when the group has no such row. */
function msOf(rows: readonly TimingRow[], label: string): number | undefined {
	return rows.find((row) => row.label === label)?.ms;
}

/** One start's timings against the manifest, entry by entry. */
export function readStart(root: string, groups: TimingGroups): StartReading {
	const rows: EntryRow[] = [];
	const missing: string[] = [];
	for (const graph of reading(root).rows) {
		const importMs = msOf(groups.extensions, `${graph.entry} module import`);
		const factoryMs = msOf(groups.extensions, `${graph.entry} factory`);
		if (importMs === undefined) missing.push(graph.name);
		rows.push({
			name: graph.name,
			entry: graph.entry,
			modules: graph.modules,
			importMs: importMs ?? 0,
			factoryMs: factoryMs ?? 0,
		});
	}
	return {
		rows,
		importMs: rows.reduce((sum, row) => sum + row.importMs, 0),
		factoryMs: rows.reduce((sum, row) => sum + row.factoryMs, 0),
		mainMs: groups.main.reduce((sum, row) => sum + row.ms, 0),
		missing,
	};
}

/** The agent directory a developer's own settings live in. */
function developerAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

/**
 * A temp agent dir that loads this checkout as its one package.
 *
 * The developer's own settings are copied so a start needs no model configured twice — the
 * child is offline and never calls one — and only `packages` is replaced, so the reading is
 * this tree rather than whatever the machine has installed.
 */
export function prepareAgentDir(root: string, settingsPath = join(developerAgentDir(), "settings.json")): string {
	const settings: Record<string, unknown> = existsSync(settingsPath)
		? (JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>)
		: {};
	if (settings.defaultProvider === undefined || settings.defaultModel === undefined) {
		throw new Error(`no default model in ${settingsPath}; a start needs one to reach the extension loader`);
	}
	const dir = tempDir("pi-start-bench-");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "settings.json"),
		`${JSON.stringify({ ...settings, packages: [{ source: root }] }, null, 2)}\n`,
	);
	return dir;
}

/** One cold `pi` start, read from its `PI_TIMING=1` output. */
export function startOnce(root: string, agentDir: string): StartReading {
	const bin = process.env.PI_BIN ?? "pi";
	const child = spawnSync(bin, ["--offline", "--no-session", "--mode", "rpc"], {
		cwd: root,
		encoding: "utf8",
		input: "",
		timeout: CHILD_TIMEOUT_MS,
		env: { ...process.env, ...ALL_EXTENSIONS_ENV, PI_TIMING: "1", PI_CODING_AGENT_DIR: agentDir },
	});
	if (child.error) throw new Error(`could not run \`${bin}\`: ${child.error.message}`);
	const groups = parseTimings(child.stderr ?? "");
	if (groups.extensions.length === 0) {
		const tail = (child.stderr ?? "").trim().split("\n").slice(-3).join(" / ");
		throw new Error(`\`${bin}\` printed no extension timings (exit ${child.status ?? "?"}): ${tail}`);
	}
	const start = readStart(root, groups);
	if (start.missing.length > 0) {
		throw new Error(
			`no timing for ${start.missing.join(", ")}; the host's labels changed or an extension failed to load`,
		);
	}
	return start;
}

/** `bun run bench:start` */
if (import.meta.main) {
	const root = join(import.meta.dir, "..");
	const agentDir = prepareAgentDir(root);
	const runs: StartReading[] = [];
	try {
		for (let index = 0; index < RUNS; index++) runs.push(startOnce(root, agentDir));
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
	// The middle total, not the best one: one cold child per run, so the spread is the point.
	const sorted = [...runs].sort((a, b) => a.importMs - b.importMs);
	const middle = sorted[Math.floor(sorted.length / 2)] as StartReading;
	const fastest = sorted[0] as StartReading;
	const slowest = sorted[sorted.length - 1] as StartReading;
	const rows = [...middle.rows].sort((a, b) => b.importMs - a.importMs || a.name.localeCompare(b.name));
	printTable(
		["entry", "modules", "import", "factory", "per module"],
		rows.map((row) => [
			row.name,
			String(row.modules),
			`${row.importMs.toFixed(0)}ms`,
			`${row.factoryMs.toFixed(0)}ms`,
			row.modules === 0 ? "?" : `${(row.importMs / row.modules).toFixed(2)}ms`,
		]),
	);

	const evaluations = middle.rows.reduce((sum, row) => sum + row.modules, 0);
	const unique = reading(root).unique;
	console.log("");
	console.log(
		`${middle.rows.length} entries · ${middle.importMs.toFixed(0)}ms import · ${middle.factoryMs.toFixed(0)}ms factory · ${evaluations} evaluations over ${unique} unique modules (×${(evaluations / unique).toFixed(2)})`,
	);
	console.log(
		`start (main namespace) · ${middle.mainMs.toFixed(0)}ms · ${RUNS} runs, median total (${fastest.importMs.toFixed(0)}–${slowest.importMs.toFixed(0)}ms import)`,
	);
	console.log("TUI init is not included; `PI_TIMING=1 PI_STARTUP_BENCHMARK=1 pi` in a terminal measures that half");
}
