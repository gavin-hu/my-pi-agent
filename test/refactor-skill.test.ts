/**
 * The `refactor` skill's inventory script.
 *
 * The script exists because an audit's measurements should not be the model's memory
 * of what it happened to open. Every number the report prints is asserted here over a
 * fixture, and the end-to-end case proves the file discovery and git calls wire up on
 * this repository without asserting its current sizes.
 */

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_LIMIT,
	formatReport,
	isTestFile,
	languageOf,
	parseArgs,
	parseNumstat,
	percentile,
	resolveImports,
	scanFile,
	summarize,
	testProximity,
} from "../skills/refactor/scripts/inventory.ts";

/** A source file's facts, as the script derives them. */
function facts(path: string, lines: readonly string[]) {
	return scanFile(path, lines.join("\n"));
}

const TS = facts("src/a.ts", [
	'import { a } from "./a";',
	'import b from "./b.js";',
	"export function f() {}",
	"export default class C {}",
	"export const x = 1;",
	"// a comment",
	"const internal = 2;",
]);

describe("languageOf", () => {
	test("reads the extension, lowercased, and nothing else", () => {
		expect(languageOf("src/a.ts")).toBe("ts");
		expect(languageOf("deep/path/x.d.ts")).toBe("ts");
		expect(languageOf("X.TSX")).toBe("tsx");
	});

	test("a name with no extension has no language", () => {
		expect(languageOf("Makefile")).toBe("");
		expect(languageOf(".gitignore")).toBe("");
	});
});

describe("scanFile", () => {
	test("counts exports and keeps import specifiers as written", () => {
		expect(TS.language).toBe("ts");
		expect(TS.exports).toBe(3);
		expect(TS.imports).toEqual(["./a", "./b.js"]);
	});

	test("a comment and a blank line are not code", () => {
		expect(TS.lines).toBe(7);
		expect(TS.codeLines).toBe(6);
		expect(facts("src/b.ts", ["", "// one", " * two", "let x = 1;", ""]).codeLines).toBe(1);
	});

	test("reads Python definitions and both import forms", () => {
		const file = facts("src/a.py", ["import os", "from .mod import thing", "def a(): pass", "class B: pass", "# note"]);
		expect(file.exports).toBe(2);
		expect(file.imports).toEqual(["os", ".mod"]);
		expect(file.codeLines).toBe(4);
	});

	test("reads a Go import block and exported declarations", () => {
		const file = facts("src/a.go", [
			"package main",
			"",
			"import (",
			'\t"fmt"',
			'\t"example.com/x"',
			")",
			"",
			"func Exported() {}",
			"func unexported() {}",
			"type Thing struct{}",
		]);
		expect(file.exports).toBe(2);
		expect(file.imports).toEqual(["fmt", "example.com/x"]);
		expect(file.codeLines).toBe(8);
	});

	test("reads a Rust pub item and a use path", () => {
		const file = facts("src/lib.rs", ["use std::fmt;", "pub fn a() {}", "fn b() {}", "pub struct S;"]);
		expect(file.exports).toBe(2);
		expect(file.imports).toEqual(["std::fmt"]);
	});

	test("measures no language it cannot read, but still counts the file", () => {
		const file = facts("README.md", ["# Title", "", "text"]);
		expect(file.language).toBe("md");
		expect(file.exports).toBe(0);
		expect(file.imports).toEqual([]);
		expect(file.lines).toBe(3);
	});

	test("counts a TODO marker, which is drift rather than a measurement", () => {
		expect(facts("src/a.ts", ["// TODO: split me"]).markers).toBe(1);
	});
});

describe("resolveImports", () => {
	const files = [
		facts("src/a.ts", [
			'import b from "./b";',
			'import "./b.js";',
			'import "./dir";',
			'import "./missing";',
			'import "react";',
		]),
		facts("src/b.ts", []),
		facts("src/dir/index.ts", []),
	];

	test("resolves a relative specifier to a file, an added extension, or an index", () => {
		const { fanIn, external, unresolved } = resolveImports(files);
		expect(fanIn.get("src/b.ts")).toBe(2);
		expect(fanIn.get("src/dir/index.ts")).toBe(1);
		expect(external).toBe(1);
		expect(unresolved).toBe(1);
	});

	test("resolves against the project's whole file list, not just the scope", () => {
		const outside = [facts("src/a.ts", ['import "./data.json";'])];
		expect(resolveImports(outside).unresolved).toBe(1);
		expect(resolveImports(outside, ["src/a.ts", "src/data.json"]).unresolved).toBe(0);
	});
});

describe("test proximity", () => {
	test("matches the convention each language uses", () => {
		const files = [
			facts("src/a.ts", []),
			facts("src/a.test.ts", []),
			facts("src/b.py", []),
			facts("src/test_b.py", []),
			facts("src/c.go", []),
			facts("src/c_test.go", []),
			facts("src/d.ts", []),
		];
		const found = testProximity(files);
		expect(found.get("src/a.ts")).toBe("src/a.test.ts");
		expect(found.get("src/b.py")).toBe("src/test_b.py");
		expect(found.get("src/c.go")).toBe("src/c_test.go");
		expect(found.has("src/d.ts")).toBe(false);
	});

	test("knows a test file when it sees one", () => {
		expect(isTestFile("a.test.ts")).toBe(true);
		expect(isTestFile("a.spec.tsx")).toBe(true);
		expect(isTestFile("a_test.go")).toBe(true);
		expect(isTestFile("test_a.py")).toBe(true);
		expect(isTestFile("a.ts")).toBe(false);
		expect(isTestFile("testimony.py")).toBe(false);
	});
});

describe("parseNumstat", () => {
	test("aggregates per commit, and a binary change is a commit with no lines", () => {
		const churn = parseNumstat(
			["abc123", "3\t0\tsrc/a.ts", "-\t-\timg.png", "def456", "1\t2\tsrc/a.ts", "5\t0\tsrc/b.ts", ""].join("\n"),
		);
		expect(churn.get("src/a.ts")).toEqual({ commits: 2, insertions: 4, deletions: 2 });
		expect(churn.get("src/b.ts")).toEqual({ commits: 1, insertions: 5, deletions: 0 });
		expect(churn.get("img.png")).toEqual({ commits: 1, insertions: 0, deletions: 0 });
	});

	test("counts a rename under the path a reader will open", () => {
		const churn = parseNumstat(["abc123", "1\t1\tsrc/{old => new}/a.ts"].join("\n"));
		expect([...churn.keys()]).toEqual(["src/new/a.ts"]);
	});
});

describe("percentile", () => {
	test("is nearest-rank, so a small sample still has a p90", () => {
		expect(percentile([1, 2, 3, 4], 50)).toBe(2);
		expect(percentile([1, 2, 3, 4], 90)).toBe(4);
		expect(percentile([], 90)).toBe(0);
	});
});

describe("summarize", () => {
	const files = [
		facts(
			"src/big.ts",
			Array.from({ length: 300 }, (_, index) => `const value${index} = ${index};`),
		),
		facts(
			"src/mid.ts",
			Array.from({ length: 120 }, (_, index) => `const value${index} = ${index};`),
		),
		facts("src/small.ts", ["export const a = 1;"]),
		facts(
			"src/small.test.ts",
			Array.from({ length: 400 }, (_, index) => `const value${index} = ${index};`),
		),
		facts("README.md", ["# Title"]),
	];

	test("names the languages it measured and the ones it skipped", () => {
		const report = summarize({ files });
		expect(report.languages).toEqual([{ name: "ts", count: 4 }]);
		expect(report.skipped).toEqual([{ name: "md", count: 1 }]);
	});

	test("a test file is measured but never a candidate", () => {
		const report = summarize({ files, options: { limit: 10 } });
		expect(report.tests.sourceFiles).toBe(3);
		expect(report.outliers.map((entry) => entry.path)).not.toContain("src/small.test.ts");
		expect(report.tests.largestUntested).not.toContain("src/small.test.ts");
	});

	test("keeps the outlier list inside the requested budget", () => {
		const report = summarize({ files, options: { limit: 1 } });
		expect(report.outliers).toHaveLength(1);
		expect(report.outliers[0].path).toBe("src/big.ts");
		expect(DEFAULT_LIMIT).toBeGreaterThan(1);
	});

	test("no history is not a churn of zero", () => {
		expect(summarize({ files, history: false }).churn.available).toBe(false);
		expect(summarize({ files, options: { churnDays: 30 } }).churn.window).toBe(30);
	});

	test("counts the churn of the files it reports", () => {
		const churn = parseNumstat(["abc123", "1\t0\tsrc/big.ts", "def456", "2\t0\tsrc/big.ts"].join("\n"));
		const report = summarize({ files, churn });
		expect(report.churn.max).toEqual({ path: "src/big.ts", commits: 2 });
		expect(report.outliers[0].commits).toBe(2);
	});
});

describe("formatReport", () => {
	const files = [facts("src/a.ts", ["export const a = 1;"]), facts("README.md", ["# Title"])];

	test("states the scope, what it skipped, and the churn window it could not read", () => {
		const report = formatReport("src", files, summarize({ files, history: false, options: { churnDays: 30 } }));
		expect(report).toContain("scope       src · 2 files · skipped 1 md");
		expect(report).toContain("churn 30d  no history: a shallow clone or a directory outside git");
		expect(report).toContain("unresolved 0");
	});

	test("names a missing outlier instead of printing an empty heading", () => {
		const report = formatReport("src", files, summarize({ files }));
		expect(report).toContain("outliers    above p90 in lines, fan-in, or churn");
		expect(report).toContain("  src/a.ts");
	});
});

describe("parseArgs", () => {
	test("a path is a target, and the flags carry their own numbers", () => {
		expect(parseArgs(["skills", "--churn-days", "30", "--limit=4"])).toEqual({
			targets: ["skills"],
			options: { churnDays: 30, limit: 4 },
		});
	});

	test("no path means the working directory, and a trailing slash is not a path", () => {
		expect(parseArgs([]).targets).toEqual(["."]);
		expect(parseArgs(["src/"]).targets).toEqual(["src"]);
	});

	test("a flag without a positive number is an error, not a zero", () => {
		expect(() => parseArgs(["--limit", "0"])).toThrow("needs a positive number");
		expect(() => parseArgs(["--churn-days"])).toThrow("needs a positive number");
	});
});

describe("the script as the skill runs it", () => {
	test("measures a real scope and exits zero", () => {
		const script = fileURLToPath(new URL("../skills/refactor/scripts/inventory.ts", import.meta.url));
		const result = Bun.spawnSync({ cmd: [process.execPath, script, "skills"], stdout: "pipe", stderr: "pipe" });
		const report = result.stdout.toString();
		expect(result.exitCode).toBe(0);
		expect(report).toContain("scope       skills");
		expect(report).toContain("languages   ts");
		expect(report).toContain("skipped");
	});
});
