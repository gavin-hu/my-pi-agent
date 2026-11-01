/**
 * What the start reading must get right, on any machine.
 *
 * The milliseconds are the host's and change every run, so this suite pins the parse and
 * the mapping only: the groups `PI_TIMING=1` prints become rows, every manifest entry is
 * matched to its own timing, and a label the host renamed is reported rather than read as
 * a free extension.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { manifestEntries } from "../test/helpers/graph.ts";
import { parseTimings, prepareAgentDir, readStart, type TimingGroups } from "./start-bench.ts";

const ROOT = join(import.meta.dir, "..");

/** The block Pi prints, captured shape: two groups, a TOTAL per group, and noise around it. */
const CAPTURED = [
	"some warning the host wrote first",
	"--- Startup Timings: main ---",
	"  parseArgs: 4ms",
	"  createAgentSessionRuntime: 256ms",
	"  TOTAL: 260ms",
	"-----------------------------",
	"",
	"--- Startup Timings: extensions ---",
	"  extensions/serve/index.ts module import: 22ms",
	"  extensions/serve/index.ts factory: 0ms",
	"  builtin:codemode factory: 1ms",
	"  TOTAL: 23ms",
	"--------------------",
	"",
].join("\n");

describe("the timing parse", () => {
	test("reads each group's rows and drops its TOTAL", () => {
		const groups = parseTimings(CAPTURED);
		expect(groups.main).toEqual([
			{ label: "parseArgs", ms: 4 },
			{ label: "createAgentSessionRuntime", ms: 256 },
		]);
		expect(groups.extensions).toEqual([
			{ label: "extensions/serve/index.ts module import", ms: 22 },
			{ label: "extensions/serve/index.ts factory", ms: 0 },
			{ label: "builtin:codemode factory", ms: 1 },
		]);
	});

	test("output with no groups is two empty groups, not a throw", () => {
		expect(parseTimings("nothing here\n  two spaces: 5ms\n")).toEqual({ main: [], extensions: [] });
	});
});

/** A timing block that names every entry the manifest declares, at a fixed height. */
function blockFor(entries: readonly string[], importMs = 10): string {
	const rows = ["--- Startup Timings: main ---", "  TOTAL: 1ms", "--- Startup Timings: extensions ---"];
	for (const entry of entries) {
		rows.push(`  ${entry} module import: ${importMs}ms`, `  ${entry} factory: 1ms`);
	}
	rows.push("  TOTAL: 0ms");
	return rows.join("\n");
}

describe("the start reading", () => {
	test("maps every manifest entry to its own timing and sums them", () => {
		const entries = manifestEntries(ROOT);
		const start = readStart(ROOT, parseTimings(blockFor(entries)));
		expect(start.rows.map((row) => row.entry)).toEqual(entries);
		expect(start.missing).toEqual([]);
		expect(start.importMs).toBe(entries.length * 10);
		expect(start.factoryMs).toBe(entries.length);
		// The module count is the graph's, from `bench:load`'s walk, not the timings'.
		expect(start.rows.find((row) => row.name === "bytefly")?.modules).toBeGreaterThan(50);
	});

	test("reports an entry the host printed nothing for", () => {
		const entries = manifestEntries(ROOT);
		const withoutOne = entries.filter((entry) => !entry.includes("bytefly"));
		const start = readStart(ROOT, parseTimings(blockFor(withoutOne)));
		expect(start.missing).toEqual(["bytefly"]);
	});

	test("a renamed group is an empty read, which the script refuses", () => {
		const groups: TimingGroups = parseTimings("--- Startup Timings: extension ---\n  a: 1ms\n");
		expect(groups.extensions).toEqual([]);
	});
});

describe("the temp agent dir", () => {
	test("points packages at this checkout and keeps the developer's model", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-start-bench-test-"));
		try {
			const settings = join(dir, "settings.json");
			writeFileSync(settings, JSON.stringify({ defaultProvider: "p", defaultModel: "m", theme: "x" }));
			const agent = prepareAgentDir(ROOT, settings);
			try {
				const written = JSON.parse(readFileSync(join(agent, "settings.json"), "utf-8")) as Record<string, unknown>;
				expect(written.packages).toEqual([{ source: ROOT }]);
				expect(written.defaultModel).toBe("m");
				expect(written.theme).toBe("x");
			} finally {
				rmSync(agent, { recursive: true, force: true });
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("refuses settings with no default model, naming the file", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-start-bench-test-"));
		try {
			const settings = join(dir, "settings.json");
			writeFileSync(settings, JSON.stringify({ theme: "x" }));
			expect(() => prepareAgentDir(ROOT, settings)).toThrow(settings);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
