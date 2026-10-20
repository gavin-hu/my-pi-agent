import { describe, expect, test } from "bun:test";
import { parseFailures } from "./failures.ts";

describe("parseFailures", () => {
	test("reads generic compiler and linter locations", () => {
		const failures = parseFailures(
			[
				"src/a.ts:12:5: error TS2322: Type 'string' is not assignable to type 'number'.",
				"  at ignore this stack frame (src/a.ts:13:2)",
				"C:\\repo\\b.ts:3:1: warning: unused variable",
			].join("\n"),
			"tsc --noEmit",
			1,
		);

		expect(failures[0]).toMatchObject({
			path: "src/a.ts",
			line: 12,
			column: 5,
			message: "error TS2322: Type 'string' is not assignable to type 'number'.",
			command: "tsc --noEmit",
		});
		expect(failures[1]).toMatchObject({ path: "C:\\repo\\b.ts", line: 3, column: 1 });
	});

	test("reads pytest's FAILED lines", () => {
		const failures = parseFailures("FAILED tests/test_api.py::test_login - assert 401 == 200", "pytest", 1);

		expect(failures).toEqual([
			{
				path: "tests/test_api.py",
				test: "test_login",
				message: "assert 401 == 200",
				command: "pytest",
			},
		]);
	});

	test("reads Vitest's FAIL path", () => {
		const failures = parseFailures(
			["FAIL  src/check.test.ts > detect > reads scripts", "  src/check.test.ts:12:5: assertion failed"].join("\n"),
			"vitest run",
			1,
		);

		expect(failures[0]).toMatchObject({ path: "src/check.test.ts", message: "Test failed" });
		expect(failures.some((failure) => failure.path === "src/check.test.ts" && failure.line === 12)).toBe(true);
	});

	test("pairs Go's test name with its location", () => {
		const failures = parseFailures(
			["--- FAIL: TestDetect (0.00s)", "    detect_test.go:12: expected cargo test"].join("\n"),
			"go test ./...",
			1,
		);

		expect(failures[0]).toMatchObject({
			test: "TestDetect",
			message: "Test failed",
		});
		expect(failures[1]).toMatchObject({
			path: "detect_test.go",
			line: 12,
			test: "TestDetect",
			message: "expected cargo test",
		});
	});

	test("reads Cargo's panic line", () => {
		const failures = parseFailures(
			"thread 'detect::tests::reads_scripts' panicked at src/detect.rs:42:5:",
			"cargo test",
			101,
		);

		expect(failures[0]).toMatchObject({
			path: "src/detect.rs",
			line: 42,
			column: 5,
			test: "detect::tests::reads_scripts",
			message: "Panicked",
		});
	});

	test("falls back to the exit status when nothing parses", () => {
		expect(parseFailures("a command wrote prose but no location\n", "make verify", 2)).toEqual([
			{ message: "Command exited with status 2", command: "make verify" },
		]);
	});

	test("a passing command has no failures even with warnings", () => {
		expect(parseFailures("src/a.ts:1:1: warning: an unused import\n", "tsc --noEmit", 0)).toEqual([]);
	});

	test("deduplicates identical failures and caps the list", () => {
		const line = "src/a.ts:1:1: error: same";
		const repeated = Array.from({ length: 250 }, () => line).join("\n");
		const failures = parseFailures(repeated, "tsc", 1);

		expect(failures).toHaveLength(1);

		const distinct = Array.from({ length: 250 }, (_, index) => `src/a${index}.ts:1:1: error: ${index}`).join("\n");
		expect(parseFailures(distinct, "tsc", 1)).toHaveLength(200);
	});
});
