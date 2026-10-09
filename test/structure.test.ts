/**
 * Layout guard for the co-located test suite.
 *
 * Tests live next to the source they cover; `test/` holds only shared helpers
 * and the package-level contract tests. See `test/README.md`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const repo = join(import.meta.dir, "..");
const testDir = join(repo, "test");
const extensionsDir = join(repo, "extensions");
const libDir = join(repo, "lib");

/** Aggregate test names that do not map to a single source module. */
const AGGREGATE_STEMS = new Set(["extension", "render"]);

function dirsOf(dir: string): string[] {
	return readdirSync(dir)
		.filter((name) => statSync(join(dir, name)).isDirectory())
		.sort();
}

function walkFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walkFiles(full, out);
		else out.push(full);
	}
	return out;
}

const ROOT_TEST_FILES = new Set(["naming.test.ts", "structure.test.ts", "theme.test.ts"]);

/**
 * Every directory whose co-located tests the banned-pattern scan covers.
 * `extensions/` is enumerated so a new extension is covered automatically;
 * `lib/` is included explicitly.
 */
const SCANNED_DIRS: string[] = [...dirsOf(extensionsDir).map((name) => join(extensionsDir, name)), libDir];

/** Files whose violations are accepted with a stated reason. Keep this tiny. */
const EXEMPT_FILES = new Set<string>([]);

interface Ban {
	name: string;
	matches: (line: string) => boolean;
	reason: string;
}

const BANS: Ban[] = [
	{
		name: "mock.module",
		matches: (line) => /\bmock\.(module|restore)\s*\(/.test(line),
		reason: "use createFakePi or add a seam",
	},
	{
		name: "process.env write",
		matches: (line) =>
			/\bprocess\.env\s*(?:\.[A-Za-z_]\w*|\[\s*[^\]]+\s*\])\s*=(?!=)|\bdelete\s+process\.env\s*(?:\.[A-Za-z_]\w*|\[\s*[^\]]+\s*\])/.test(
				line,
			),
		reason: "use test/helpers/env.ts",
	},
	{
		name: "real timer",
		matches: (line) => /\bset(Timeout|Interval)\s*\(/.test(line),
		reason: "use settle() from test/helpers/process.ts",
	},
	{
		name: "wall clock",
		matches: (line) => /\bDate\.now\s*\(|\bnew\s+Date\s*\(/.test(line),
		reason: "inject makeClock() from test/helpers/clock.ts",
	},
	{
		name: "padding assertion",
		matches: (line) => /\b(?:toBe|toEqual|toContain|toMatch)\s*\(\s*[`"'][^`"'\n]* {3,}[^`"'\n]*[`"']/.test(line),
		reason: "assert fields/width/order, not column padding",
	},
	{
		name: "local theme double",
		matches: (line) => /\bfg\s*:/.test(line),
		reason: "use fakeTheme from test/helpers/fakes.ts",
	},
];

/**
 * Lines in `file` that match a ban, as `path:line: alert (reason)`.
 * A line may opt out of one ban with an `allow:<name>` comment when the
 * matched text is genuine content (for example a whitespace-normalisation
 * assertion), not layout padding.
 */
function scanBans(file: string): string[] {
	if (EXEMPT_FILES.has(file)) return [];
	const relative = file.slice(repo.length + 1);
	const violations: string[] = [];
	readFileSync(file, "utf-8")
		.split("\n")
		.forEach((line, index) => {
			for (const ban of BANS) {
				if (line.includes(`allow:${ban.name}`)) continue;
				if (ban.matches(line)) violations.push(`${relative}:${index + 1}: ${ban.name} (${ban.reason})`);
			}
		});
	return violations;
}

describe("test layout", () => {
	test("test/ holds only helpers and package-level tests", () => {
		expect(dirsOf(testDir)).toEqual(["helpers"]);
		const rootTests = readdirSync(testDir).filter((name) => name.endsWith(".test.ts"));
		expect(new Set(rootTests)).toEqual(ROOT_TEST_FILES);
	});

	test("every extension has co-located tests", () => {
		for (const name of dirsOf(extensionsDir)) {
			const files = walkFiles(join(extensionsDir, name));
			const hasTest = files.some((file) => file.endsWith(".test.ts"));
			expect(hasTest, `extensions/${name} has no co-located test`).toBe(true);
		}
	});

	test("helper files live only under test/helpers", () => {
		const helperFiles = [extensionsDir, libDir, testDir]
			.flatMap((root) => walkFiles(root))
			.filter((file) => file.endsWith("/helpers.ts") && !file.startsWith(join(testDir, "helpers")));
		expect(helperFiles).toEqual([]);
	});

	test("each co-located test sits beside a source module of the same stem", () => {
		const offenders: string[] = [];
		for (const root of [extensionsDir, libDir]) {
			for (const file of walkFiles(root)) {
				if (!file.endsWith(".test.ts")) continue;
				const stem = file.slice(file.lastIndexOf("/") + 1).replace(/\.test\.ts$/, "");
				if (AGGREGATE_STEMS.has(stem)) continue;
				const sibling = file.replace(/\.test\.ts$/, ".ts");
				if (!existsSync(sibling)) offenders.push(file.slice(repo.length + 1));
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe("test conventions", () => {
	test("test files avoid the banned test patterns", () => {
		const offenders: string[] = [];
		for (const dir of SCANNED_DIRS) {
			for (const file of walkFiles(dir)) {
				if (file.endsWith(".test.ts")) offenders.push(...scanBans(file));
			}
		}
		expect(offenders).toEqual([]);
	});
});
