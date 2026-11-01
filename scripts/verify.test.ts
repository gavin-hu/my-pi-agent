/**
 * What a command line means, and what it says before it runs.
 *
 * The command itself spawns `bun test`, so nothing here spawns anything: the
 * parse, the flag set the child gets, and the printed plan are the testable
 * surface, and `--dry-run` is the same path with the spawns removed.
 */

import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { selectExt } from "./test-selection.ts";
import { FLAGS, type Plan, parseArgs, planLines, selectionFor, testFlags } from "./verify.ts";

const repo = join(import.meta.dir, "..");

const all: Plan = {
	scope: "all",
	names: [],
	base: "main",
	serial: false,
	watch: false,
	testsOnly: false,
	dryRun: false,
};

describe("the command line", () => {
	test("no argument is the whole gate, in parallel, against main", () => {
		expect(parseArgs([])).toEqual(all);
	});

	test("each scope flag replaces the default, and a name is a name", () => {
		const cases: [string[], Partial<Plan>][] = [
			[["--static"], { scope: "static" }],
			[["--root"], { scope: "root" }],
			[["--slow"], { scope: "slow" }],
			[["--changed"], { scope: "changed" }],
			[["--changed", "--base", "develop"], { scope: "changed", base: "develop" }],
			[["--ext", "board", "wechat"], { scope: "ext", names: ["board", "wechat"] }],
			[["--lib", "board"], { scope: "lib", names: ["board"] }],
			[["--tests"], { testsOnly: true }],
			[["--serial"], { serial: true }],
			[["--watch"], { watch: true }],
			[["--dry-run"], { dryRun: true }],
		];
		const wrong = cases
			.map(([argv, expected]) => ({ got: parseArgs(argv), expected: { ...all, ...expected } }))
			.filter(({ got, expected }) => JSON.stringify(got) !== JSON.stringify(expected))
			.map(({ got }) => JSON.stringify(got));
		expect(wrong).toEqual([]);
	});

	test("a second scope is refused by name, not resolved to one of them", () => {
		expect(() => parseArgs(["--ext", "board", "--root"])).toThrow("--ext and --root pick two scopes; give one");
		expect(() => parseArgs(["--base", "develop"])).toThrow("--base names the revision --changed diffs against");
		expect(() => parseArgs(["--static", "--watch"])).toThrow("--watch runs the tests, and --static runs none");
		expect(() => parseArgs(["--ext"])).toThrow("--ext needs a name");
		expect(() => parseArgs(["--lib"])).toThrow("--lib needs a name");
		expect(() => parseArgs(["board"])).toThrow("unexpected argument board; a name follows --ext or --lib");
		expect(() => parseArgs(["--nope"])).toThrow("unknown option --nope");
	});

	test("every flag the docs may name is one the parser takes", () => {
		const refused = FLAGS.filter((flag) => {
			try {
				parseArgs(
					flag === "--base"
						? [flag, "main", "--changed"]
						: flag === "--ext" || flag === "--lib"
							? [flag, "board"]
							: [flag],
				);
				return false;
			} catch {
				return true;
			}
		});
		expect(refused).toEqual([]);
	});
});

describe("the flags the child gets", () => {
	test("parallel by default, one file at a time when asked, and watch implies isolate", () => {
		expect(testFlags(all)).toEqual(["--parallel=4", "--timeout", "30000"]);
		expect(testFlags({ ...all, serial: true })).toEqual(["--timeout", "30000"]);
		expect(testFlags({ ...all, watch: true })).toEqual(["--watch", "--isolate"]);
	});
});

describe("the printed plan", () => {
	test("a static run names the static half and no tests", () => {
		expect(planLines({ ...all, scope: "static" }, undefined)).toEqual(["static > format:check, typecheck"]);
	});

	test("a test-only run names no static half", () => {
		expect(planLines({ ...all, testsOnly: true }, selectExt(["board"])).at(0)).toContain("ext:board");
	});

	test("a run says why each group is in it, then what it will execute", () => {
		const plan = { ...all, scope: "changed" as const };
		const lines = planLines(plan, { tests: ["a", "b"], reasons: ["package-level > 2 files, always"] });
		expect(lines).toEqual([
			"static > format:check, typecheck",
			"  package-level > 2 files, always",
			"tests > 2 files · bun test --parallel=4 --timeout 30000",
		]);
	});
});

describe("the selection a plan names", () => {
	test("a static run selects nothing to test", () => {
		expect(selectionFor(repo, { ...all, scope: "static" })).toBeUndefined();
	});

	test("--ext and --root resolve against the tree, and --ext keeps its refusal", () => {
		expect(selectionFor(repo, { ...all, scope: "ext", names: ["board"] })?.tests).toEqual(selectExt(["board"]).tests);
		expect(selectionFor(repo, { ...all, scope: "root" })?.tests).toContain("test/layout.test.ts");
		expect(() => selectionFor(repo, { ...all, scope: "ext", names: ["nope"] })).toThrow("--ext names no such ext");
	});
});
