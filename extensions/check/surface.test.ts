/**
 * The check capability's presentation contract: config, failure parsing, text,
 * the transcript block, both screens, the `run_check` tool, and `/check`.
 *
 * Every screen is driven directly over the shared theme double; the runtime and
 * the tool's execution are doubles, so nothing here spawns a process.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { PLAN_MODE_ENTRY_TYPE } from "../../lib/plan-state.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";
import { createFakePi, fakeTheme, makeFakePi } from "../../test/helpers/fakes.ts";
import { registerCheckCommand } from "./commands.ts";
import { DEFAULT_CONFIG, loadConfig, normalizeConfig, type CheckConfig } from "./config.ts";
import { parseFailures } from "./failures.ts";
import {
	MODEL_FAILURES,
	formatCheckReport,
	formatCheckSummary,
	formatFailureDetail,
	formatFailureLine,
	formatFailureLocation,
	formatResultSummary,
	formatSourceExcerpt,
} from "./format.ts";
import { COLLAPSED_ROWS, CheckResultBlock } from "./render.ts";
import { CheckError, type CheckRuntime } from "./runtime.ts";
import { TOOL_NAME, registerCheckTool } from "./tools.ts";
import { CheckResultComponent, CheckRunComponent } from "./tui.ts";
import type { CheckResult, CheckTarget, Failure, RunCheckDetails } from "./types.ts";

const directories: string[] = [];
afterAll(() => {
	for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

/** A tracked temp directory. */
function tempProject(prefix: string): string {
	const dir = tempDir(prefix);
	directories.push(dir);
	return dir;
}

const FAILURE: Failure = {
	path: "src/a.ts",
	line: 12,
	column: 5,
	message: "expected 1 to be 2",
	command: "bun run test",
};

/** A result fixture. */
function result(overrides: Partial<CheckResult> = {}): CheckResult {
	return {
		target: "all",
		status: "failed",
		commands: ["bun run test"],
		exitCode: 1,
		durationMs: 1200,
		truncated: false,
		failures: [FAILURE],
		tail: "tail one\ntail two",
		...overrides,
	};
}

describe("config", () => {
	test("keeps the defaults for missing or malformed values", () => {
		for (const raw of [
			undefined,
			{},
			{ command: 12, timeoutMs: "soon", maxLogBytes: [] },
			{ command: "   ", timeoutMs: null },
		]) {
			expect(normalizeConfig(raw, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
		}
	});

	const CLAMPS: ReadonlyArray<{ key: keyof CheckConfig; raw: unknown; expected: number }> = [
		{ key: "timeoutMs", raw: 1, expected: 1 },
		{ key: "timeoutMs", raw: 99_999_999, expected: 3_600_000 },
		{ key: "timeoutMs", raw: 0, expected: 0 },
		{ key: "maxLogBytes", raw: 1, expected: 65_536 },
		{ key: "maxLogBytes", raw: 99_999_999, expected: 16_777_216 },
	];

	for (const { key, raw, expected } of CLAMPS) {
		test(`clamps ${key}=${String(raw)} to ${expected}`, () => {
			expect(normalizeConfig({ [key]: raw }, DEFAULT_CONFIG)[key]).toBe(expected);
		});
	}

	test("trims the command override", () => {
		expect(normalizeConfig({ command: "  make verify  " }, DEFAULT_CONFIG).command).toBe("make verify");
	});

	test("merges global then project, with project winning and limits clamped", async () => {
		await withAgentDir(async (agentDir) => {
			writeFileSync(
				join(agentDir, "bytefly.json"),
				JSON.stringify({ check: { command: " global ", timeoutMs: 1, maxLogBytes: 99_999_999 } }),
			);
			const dir = tempProject("pi-check-config-");
			mkdirSync(join(dir, ".pi"), { recursive: true });
			writeFileSync(join(dir, ".pi", "bytefly.json"), JSON.stringify({ check: { command: "project", timeoutMs: 0 } }));

			expect(loadConfig(dir)).toEqual({ command: "project", timeoutMs: 0, maxLogBytes: 16_777_216 });
		});
	});

	test("returns the defaults outside a configured project", async () => {
		await withAgentDir(async () => {
			expect(loadConfig(tempProject("pi-check-empty-config-"))).toEqual(DEFAULT_CONFIG);
		});
	});
});

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
		expect(failures.find((failure) => failure.path === "C:\\repo\\b.ts")).toMatchObject({ line: 3, column: 1 });
		expect(failures.some((failure) => failure.path === "src/a.ts" && failure.line === 13)).toBe(true);
	});

	const FRAMES: ReadonlyArray<{ name: string; output: string; command: string; expected: Partial<Failure> }> = [
		{
			name: "a bare stack frame under a test name",
			output: ["● adds", "  at src/b.ts:3:4"].join("\n"),
			command: "bun run test",
			expected: { path: "src/b.ts", line: 3, column: 4, test: "adds", message: "Test failed" },
		},
		{
			name: "a Java stack frame",
			output: "at com.foo.Bar.baz(Bar.java:12)",
			command: "gradle test",
			expected: { path: "Bar.java", line: 12, message: "Stack frame" },
		},
		{
			name: "a Python traceback line",
			output: '  File "tests/test_a.py", line 12, in test_x',
			command: "pytest",
			expected: { path: "tests/test_a.py", line: 12, message: "Traceback" },
		},
		{
			name: "a Cargo panic",
			output: "thread 'detect::tests::reads_scripts' panicked at src/detect.rs:42:5:",
			command: "cargo test",
			expected: {
				path: "src/detect.rs",
				line: 42,
				column: 5,
				test: "detect::tests::reads_scripts",
				message: "Panicked",
			},
		},
	];

	for (const frame of FRAMES) {
		test(`reads ${frame.name}`, () => {
			expect(parseFailures(frame.output, frame.command, 1)[0]).toMatchObject(frame.expected);
		});
	}

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

	test("reads Vitest's FAIL path and its located line", () => {
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

		expect(failures[0]).toMatchObject({ test: "TestDetect", message: "Test failed" });
		expect(failures[1]).toMatchObject({
			path: "detect_test.go",
			line: 12,
			test: "TestDetect",
			message: "expected cargo test",
		});
	});

	test("attaches a Jest/Vitest stack frame to its test name", () => {
		const failures = parseFailures(
			[
				"FAIL src/a.test.ts > adds",
				"  ● suite > adds numbers",
				"    expect(received).toBe(expected)",
				"    at Object.<anonymous> (src/a.test.ts:12:5)",
			].join("\n"),
			"bun run test",
			1,
		);

		expect(failures).toContainEqual({
			path: "src/a.test.ts",
			line: 12,
			column: 5,
			test: "suite > adds numbers",
			message: "Test failed",
			command: "bun run test",
		});
	});

	test("does not parse stack frames from a passing run", () => {
		expect(parseFailures("  at src/a.test.ts:12:5\n", "bun run test", 0)).toEqual([]);
	});

	test("a passing command has no failures even with warnings", () => {
		expect(parseFailures("src/a.ts:1:1: warning: an unused import\n", "tsc --noEmit", 0)).toEqual([]);
	});

	test("falls back to the exit status when nothing parses", () => {
		expect(parseFailures("a command wrote prose but no location\n", "make verify", 2)).toEqual([
			{ message: "Command exited with status 2", command: "make verify" },
		]);
		expect(parseFailures("", "make verify", null)).toEqual([
			{ message: "Command did not exit cleanly", command: "make verify" },
		]);
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

describe("failure formatting", () => {
	test("names the location and the one-line failure", () => {
		expect(formatFailureLocation(FAILURE)).toBe("src/a.ts:12:5");
		expect(formatFailureLine(FAILURE)).toBe("src/a.ts:12:5 · expected 1 to be 2");
		expect(formatFailureLocation({ message: "x", command: "c", test: "adds" })).toBe("adds");
		expect(formatFailureLocation({ message: "x", command: "c" })).toBe("check");
	});

	const SUMMARIES: ReadonlyArray<{ name: string; value: CheckResult; expected: string }> = [
		{
			name: "a pass",
			value: result({ status: "passed", exitCode: 0, failures: [] }),
			expected: "Check passed: bun run test · 1.2s",
		},
		{ name: "a failure", value: result(), expected: "Check failed: 1 failure · bun run test · 1.2s" },
		{ name: "a timeout", value: result({ status: "timeout" }), expected: "Check timed out: bun run test · 1.2s" },
		{ name: "a cancel", value: result({ status: "cancelled" }), expected: "Check cancelled: bun run test" },
		{
			name: "an error",
			value: result({ status: "error", error: "no command" }),
			expected: "Check failed to run: no command",
		},
	];

	for (const summary of SUMMARIES) {
		test(`summarizes ${summary.name}`, () => {
			expect(formatCheckSummary(summary.value)).toBe(summary.expected);
		});
	}

	const RESULT_SUMMARIES: ReadonlyArray<{ name: string; value: CheckResult; expected: string }> = [
		{ name: "a failure", value: result(), expected: "1 failure · bun run test · 1.2s" },
		{ name: "a timeout", value: result({ status: "timeout" }), expected: "timed out · bun run test · 1.2s" },
		{
			name: "an unparsed failure",
			value: result({ failures: [{ message: "Command exited with status 2", command: "make verify" }] }),
			expected: "failed · bun run test · 1.2s",
		},
		{
			name: "a pass",
			value: result({ status: "passed", failures: [] }),
			expected: "passed · bun run test · 1.2s",
		},
	];

	for (const summary of RESULT_SUMMARIES) {
		test(`keeps the result summary short for ${summary.name}`, () => {
			expect(formatResultSummary(summary.value)).toBe(summary.expected);
		});
	}

	test("labels a running summary", () => {
		expect(formatResultSummary({ status: "running", commands: ["bun run test"], durationMs: 1200, failures: [] })).toBe(
			"running · bun run test · 1.2s",
		);
	});

	test("renders a source excerpt with aligned numbers and a target marker", () => {
		const lines = formatSourceExcerpt({
			startLine: 5,
			endLine: 7,
			targetLine: 6,
			lines: ["before", "t\tab", "after"],
		});

		expect(lines).toEqual(["  5 │ before", "> 6 │ t    ab", "  7 │ after"]);
	});

	test("shows the source instead of the tail when it is available", () => {
		const detail = formatFailureDetail(FAILURE, "tail text", {
			ok: true,
			excerpt: { startLine: 12, endLine: 12, targetLine: 12, lines: ["const answer = 42;"] },
		});

		expect(detail).toContain("Source:");
		expect(detail.some((line) => line.includes("> 12 │ const answer = 42;"))).toBe(true);
		expect(detail).not.toContain("tail text");
	});

	test("names why the source is unavailable and keeps the tail", () => {
		const detail = formatFailureDetail(FAILURE, "tail text", { ok: false, reason: "file is missing" });

		expect(detail).toContain("(source unavailable: file is missing)");
		expect(detail).toContain("tail text");
	});

	test("falls back to the tail without a source or a path", () => {
		expect(formatFailureDetail(FAILURE, "tail text")).toContain("tail text");
		expect(
			formatFailureDetail({ ...FAILURE, path: undefined }, "tail text", { ok: false, reason: "no file location" }),
		).not.toContain("source unavailable");
	});

	test("caps the model report and includes the fallback tail", () => {
		const many = Array.from({ length: MODEL_FAILURES + 2 }, (_, index) => ({
			...FAILURE,
			line: index + 1,
		}));
		const report = formatCheckReport(result({ failures: many }));

		expect(report).toContain(`Check failed: ${MODEL_FAILURES + 2} failures`);
		expect(report).toContain("… 2 more failures in details");

		const fallback = formatCheckReport(
			result({ failures: [{ message: "Command exited with status 2", command: "make verify" }] }),
		);
		expect(fallback).toContain("Tail:");
		expect(fallback).toContain("tail one");
	});
});

/** The transcript block's details fixture. */
function details(overrides: Partial<RunCheckDetails> = {}): RunCheckDetails {
	return {
		target: "all",
		status: "failed",
		commands: ["bun run check"],
		exitCode: 1,
		durationMs: 12_400,
		truncated: false,
		failures: [{ ...FAILURE, command: "bun run check" }],
		tail: "",
		...overrides,
	};
}

/** Render the transcript block to plain text. */
function blockText(overrides: Partial<RunCheckDetails> = {}, expanded = false, width = 80): string {
	const block = new CheckResultBlock({ details: details(overrides), expanded }, fakeTheme);
	return stripTerminalSequences(block.render(width).join("\n"));
}

/** `count` failures on distinct source lines. */
function manyFailures(count: number): Failure[] {
	return Array.from({ length: count }, (_, index) => ({ ...FAILURE, line: index + 1 }));
}

describe("check result block", () => {
	test("draws a pass in one line", () => {
		const out = blockText({ status: "passed", exitCode: 0, failures: [] });

		expect(out).toContain("✓");
		expect(out).toContain("passed · bun run check · 12.4s");
		expect(out.split("\n")).toHaveLength(1);
	});

	test("caps a collapsed failure list and offers the expand key", () => {
		const out = blockText({ failures: manyFailures(COLLAPSED_ROWS + 2) });

		expect(out).toContain("src/a.ts:5");
		expect(out).not.toContain("src/a.ts:6");
		expect(out).toContain("2 more failures");
		expect(out).toContain("to expand");
	});

	test("shows the model cap when expanded and points at the full screen", () => {
		const out = blockText({ failures: manyFailures(25) }, true);

		expect(out).toContain("src/a.ts:20");
		expect(out).not.toContain("src/a.ts:21");
		expect(out).toContain("5 more failures");
		expect(out).toContain("/check lists all");
	});

	test("names the command per row only when several commands ran", () => {
		expect(blockText({ failures: [FAILURE] })).not.toContain("bun run check · expected");
		expect(blockText({ commands: ["bun run test", "bun run lint"], failures: [FAILURE] })).toContain(
			"expected 1 to be 2 · bun run test",
		);
	});

	test("shows the tail instead of an exit-status row when nothing parsed", () => {
		const tail = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n");
		const out = blockText({
			exitCode: 2,
			failures: [{ message: "Command exited with status 2", command: "make verify" }],
			tail,
		});

		expect(out).not.toContain("Command exited with status 2");
		expect(out).toContain("failed · bun run check · 12.4s");
		expect(out).toContain("exit 2");
		expect(out).toContain("no parsed failure; last output:");
		expect(out).toContain("line 8");
		expect(out).not.toContain("line 3");
		expect(out).toContain("3 earlier lines");
	});

	test("shows the whole bounded tail when expanded", () => {
		const tail = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n");
		const out = blockText(
			{ exitCode: 2, failures: [{ message: "Command exited with status 2", command: "make verify" }], tail },
			true,
		);

		expect(out).toContain("line 1");
		expect(out).toContain("line 8");
		expect(out).not.toContain("earlier lines");
	});

	test("draws a timeout with its last output", () => {
		const out = blockText({ status: "timeout", exitCode: null, failures: [], tail: "hit the limit" });

		expect(out).toContain("timed out");
		expect(out).toContain("last output:");
		expect(out).toContain("hit the limit");
	});

	test("keeps a cancelled run to its summary", () => {
		const out = blockText({ status: "cancelled", exitCode: null, failures: [] });

		expect(out).toContain("cancelled");
		expect(out).not.toContain("last output:");
	});

	test("notes a truncated log", () => {
		expect(blockText({ truncated: true })).toContain("log truncated");
	});

	test("sanitizes a message and a command from command output", () => {
		const out = blockText({
			failures: [
				{
					path: "src/a.ts",
					line: 1,
					message: "bad \u001b[31mred\u001b[0m",
					command: "bun run \u0007check",
				},
			],
			commands: ["bun run \u001b[32mcheck"],
		});

		expect(out).not.toMatch(/[\u001b\u0007]/);
		expect(out).toContain("red");
	});

	test("fits every line at a narrow width", () => {
		const long = {
			...FAILURE,
			path: `src/${"deep/".repeat(10)}file.ts`,
			message: "a".repeat(300),
		};
		for (const width of [40, 80]) {
			const block = new CheckResultBlock(
				{ details: details({ failures: [long], tail: "b".repeat(300) }), expanded: true },
				fakeTheme,
			);
			for (const line of block.render(width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});
});

const SCREEN_FAILURES: Failure[] = [
	{
		path: "extensions/check/detect.test.ts",
		line: 88,
		column: 5,
		message: "expected cargo test",
		command: "bun run check",
	},
	{ path: "extensions/check/failures.test.ts", line: 41, message: "expected 2 failures", command: "bun run check" },
	{ test: "TestDetect", message: "Test failed", command: "go test ./..." },
];

const SCREEN_RESULT: CheckResult = {
	target: "all",
	status: "failed",
	commands: ["bun run check"],
	exitCode: 1,
	durationMs: 12_400,
	truncated: false,
	failures: SCREEN_FAILURES,
	tail: "src/check.test.ts:12: nope\nmore output",
};

/** Mount the result screen over the shared fixtures. */
function screen(overrides: Partial<CheckResult> = {}, cwd = "/tmp") {
	const closed = { rerun: 0, close: 0 };
	const component = new CheckResultComponent({
		result: { ...SCREEN_RESULT, ...overrides },
		cwd,
		theme: fakeTheme,
		onRerun: () => {
			closed.rerun += 1;
		},
		onClose: () => {
			closed.close += 1;
		},
		requestRender: () => {},
		viewportRows: () => 40,
	});
	return { component, closed };
}

/** Render a screen to plain text. */
function screenText(component: { render: (width: number) => string[] }, width = 80): string {
	return stripTerminalSequences(component.render(width).join("\n"));
}

describe("check run screen", () => {
	test("tails the output, shows the command and elapsed time, and cancels", () => {
		const lines = ["$ bun run test", "✓ one", "✗ two"];
		let cancelled = 0;
		const component = new CheckRunComponent({
			command: "bun run test",
			lines: () => lines,
			elapsedMs: () => 3200,
			theme: fakeTheme,
			onCancel: () => {
				cancelled += 1;
			},
			requestRender: () => {},
			viewportRows: () => 20,
		});

		const text = screenText(component);
		expect(text).toContain("running");
		expect(text).toContain("bun run test");
		expect(text).toContain("✓ one");
		expect(text).toContain("Esc cancel");

		component.handleInput("\u001b");
		expect(cancelled).toBe(1);
	});

	test("keeps every line within the width", () => {
		const component = new CheckRunComponent({
			command: "a very long command with a path and arguments",
			lines: () => ["+".repeat(300)],
			elapsedMs: () => 1000,
			theme: fakeTheme,
			onCancel: () => {},
			requestRender: () => {},
			viewportRows: () => 20,
		});

		for (const width of [24, 40, 80]) {
			for (const line of component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});

describe("check result screen", () => {
	test("lists failures with their locations and the focused message", () => {
		const { component } = screen();
		const text = screenText(component);

		expect(text).toContain("3 failures");
		expect(text).toContain("bun run check");
		expect(text).toContain("detect.test.ts:88:5");
		expect(text).toContain("expected cargo test");
		expect(text).toContain("Enter detail");
	});

	test("opens the detail pane and goes back with Escape", () => {
		const { component } = screen();
		component.handleInput("\r");
		const detail = screenText(component);

		expect(detail).toContain("detect.test.ts:88:5 · bun run check");
		expect(detail).toContain("more output");
		expect(detail).toContain("Esc back");

		component.handleInput("\u001b");
		expect(screenText(component)).toContain("3 failures");
	});

	test("r reruns and Escape closes from the list", () => {
		const { component, closed } = screen();
		component.handleInput("r");
		component.handleInput("\u001b");

		expect(closed.rerun).toBe(1);
		expect(closed.close).toBe(1);
	});

	test("reads the source around the focused failure", () => {
		const cwd = tempProject("pi-check-tui-source-");
		mkdirSync(join(cwd, "src"), { recursive: true });
		writeFileSync(join(cwd, "src", "a.ts"), Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n"));
		const { component } = screen(
			{ failures: [{ path: "src/a.ts", line: 10, message: "nope", command: "bun run test" }] },
			cwd,
		);

		component.handleInput("\r");
		const text = screenText(component);

		expect(text).toContain("Source:");
		expect(text).toContain("> 10 │ line 10");
		expect(text).toContain("line 5");
		expect(text).toContain("line 15");
	});

	test("renders an empty failure list without pretending it parsed", () => {
		const { component } = screen({ failures: [] });

		expect(screenText(component)).toContain("No failures parsed.");
	});

	test("windows a long failure list", () => {
		const many: Failure[] = Array.from({ length: 60 }, (_, index) => ({
			path: `src/file-${String(index).padStart(2, "0")}.ts`,
			line: index + 1,
			message: `failure ${index}`,
			command: "bun run check",
		}));
		const { component } = screen({ failures: many });

		const text = screenText(component);
		expect(text).toContain("of 60");
		expect(text).not.toContain("file-59");
	});

	test("keeps every line within the width", () => {
		const long: Failure[] = [
			{
				path: `src/${"nested/".repeat(10)}a-very-long-failure-path.ts`,
				line: 123,
				message: "x".repeat(200),
				command: "bun run check",
			},
		];
		const { component } = screen({ failures: long });

		for (const width of [24, 40, 80, 120]) {
			for (const line of component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});

/** A runtime double whose runs settle with `value` (or its Nth result). */
function runtimeFor(value: CheckResult | ((call: number) => CheckResult)) {
	const seen: CheckTarget[] = [];
	let calls = 0;
	const next = (): CheckResult => (typeof value === "function" ? value(calls++) : (calls++, value));
	const runtime = {
		start: (target: CheckTarget) => {
			seen.push(target);
			const settled = next();
			return {
				target,
				commands: settled.commands,
				lines: () => ["$ fake-check"],
				elapsedMs: () => settled.durationMs,
				promise: Promise.resolve(settled),
				cancel: () => {},
			};
		},
		run: async (target: CheckTarget) => {
			seen.push(target);
			return next();
		},
		isRunning: () => false,
		shutdown: () => {},
	} as unknown as CheckRuntime;
	return { runtime, seen };
}

/** Register the `run_check` tool over a runtime. */
function toolFor(runtime: CheckRuntime) {
	const fake = createFakePi();
	registerCheckTool(fake.pi, runtime);
	return fake.tools.get(TOOL_NAME);
}

/** A render context with the fields the tool's renderers read. */
function renderContext(overrides: Record<string, unknown> = {}) {
	return {
		args: {},
		toolCallId: "call-1",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: "/home/u/repo",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
		...overrides,
	};
}

/** Mount a result on the tool's renderer and return its plain text. */
function mount(
	tool: { renderResult: (...args: unknown[]) => { render: (width: number) => string[] } },
	toolResult: { content: unknown; details: unknown },
	options: { expanded?: boolean; isPartial?: boolean } = {},
	context = renderContext(options),
): string {
	const component = tool.renderResult(
		toolResult,
		{ expanded: options.expanded === true, isPartial: options.isPartial === true },
		fakeTheme,
		context,
	);
	return stripTerminalSequences(component.render(80).join("\n"));
}

/** The tool's call line as plain text. */
function callText(
	tool: { renderCall: (...args: unknown[]) => { render: (width: number) => string[] } },
	args: Record<string, unknown>,
	context = renderContext(),
): string {
	return stripTerminalSequences(tool.renderCall(args, fakeTheme, context).render(80).join("\n"));
}

describe("run_check tool", () => {
	test("registers a sequential, mutating tool with its schemas", () => {
		const { runtime } = runtimeFor(result());
		const tool = toolFor(runtime);

		expect(tool.label).toBe("Run checks");
		expect(tool.executionMode).toBe("sequential");
		expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
		expect(tool.parameters).toBeDefined();
		expect(tool.outputSchema).toBeDefined();
		expect(tool.promptSnippet).toContain("Run the project's checks");
		expect(tool.promptGuidelines.length).toBeGreaterThan(0);
	});

	test("reports a passing run", async () => {
		const tool = toolFor(runtimeFor(result({ status: "passed", exitCode: 0, failures: [], tail: "" })).runtime);
		const outcome = await tool.execute("t", { target: "all" }, undefined, undefined, {} as never);

		expect(outcome.isError).toBe(false);
		expect(outcome.content[0]?.text).toContain("Check passed: bun run test");
		expect(outcome.structuredContent).toMatchObject({ target: "all", status: "passed", exitCode: 0 });
		expect(outcome.details.tail).toBe("");
	});

	test("reports a failing run as a normal result, not a tool error", async () => {
		const tool = toolFor(runtimeFor(result()).runtime);
		const outcome = await tool.execute("t", {}, undefined, undefined, {} as never);

		expect(outcome.isError).toBe(false);
		expect(outcome.content[0]?.text).toContain("Check failed: 1 failure");
		expect(outcome.content[0]?.text).toContain("src/a.ts:12");
		expect(outcome.structuredContent?.failures).toHaveLength(1);
	});

	test("reports a planning error as a tool error", async () => {
		const { runtime } = runtimeFor(
			result({ status: "error", commands: [], exitCode: null, error: "No command detected" }),
		);
		const tool = toolFor(runtime);
		const outcome = await tool.execute("t", {}, undefined, undefined, {} as never);

		expect(outcome.isError).toBe(true);
		expect(outcome.content[0]?.text).toContain("Check failed to run");
		expect(outcome.structuredContent?.status).toBe("error");
	});

	test("defaults the target to all", async () => {
		const { runtime, seen } = runtimeFor(result());
		const tool = toolFor(runtime);
		await tool.execute("t", {}, undefined, undefined, {} as never);

		expect(seen).toEqual(["all"]);
	});

	test("falls back to the tail when nothing parsed", async () => {
		const { runtime } = runtimeFor(
			result({
				failures: [{ message: "Command exited with status 2", command: "make verify" }],
				tail: "prose\nmore prose",
			}),
		);
		const tool = toolFor(runtime);
		const outcome = await tool.execute("t", { target: "all" }, undefined, undefined, {} as never);

		expect(outcome.content[0]?.text).toContain("Tail:");
		expect(outcome.content[0]?.text).toContain("more prose");
	});

	test("publishes one running result before the run settles", async () => {
		const { runtime } = runtimeFor(result());
		const tool = toolFor(runtime);
		const partials: Array<{ details: RunCheckDetails }> = [];
		await tool.execute(
			"t",
			{ target: "all" },
			undefined,
			(partial: { details: RunCheckDetails }) => {
				partials.push(partial);
			},
			{} as never,
		);

		expect(partials).toHaveLength(1);
		expect(partials[0]?.details).toMatchObject({
			target: "all",
			status: "running",
			commands: ["bun run test"],
			failures: [],
		});
	});
});

describe("run_check transcript", () => {
	test("names the target on the call line", () => {
		const { runtime } = runtimeFor(result());
		const tool = toolFor(runtime);

		expect(callText(tool, { target: "test" })).toContain("run_check");
		expect(callText(tool, { target: "test" })).toContain("test");
		expect(callText(tool, {})).toContain("all");
		expect(callText(tool, {}, renderContext({ argsComplete: false }))).toContain("…");
	});

	test("draws the capped block and never the model report", async () => {
		const { runtime } = runtimeFor(result({ tail: "src/a.ts:12: nope" }));
		const tool = toolFor(runtime);
		const outcome = await tool.execute("t", {}, undefined, undefined, {} as never);
		const text = mount(tool, outcome);

		expect(text).toContain("src/a.ts:12:5 · expected 1 to be 2");
		expect(text).not.toContain("Check failed:");
	});

	test("draws an error result as an error line", async () => {
		const { runtime } = runtimeFor(
			result({ status: "error", commands: [], exitCode: null, error: "No command detected" }),
		);
		const tool = toolFor(runtime);
		const outcome = await tool.execute("t", {}, undefined, undefined, {} as never);

		expect(mount(tool, outcome)).toContain("Error: No command detected");
	});

	test("draws a running line from the partial result", async () => {
		const { runtime } = runtimeFor(result());
		const tool = toolFor(runtime);
		let partial: { details: RunCheckDetails } | undefined;
		const outcome = await tool.execute(
			"t",
			{},
			undefined,
			(value: { details: RunCheckDetails }) => {
				partial = value;
			},
			{} as never,
		);
		expect(partial).toBeDefined();

		const context = renderContext({ isPartial: true });
		const text = mount(tool, partial as { content: unknown; details: unknown }, { isPartial: true }, context);
		expect(text).toContain("Running bun run test…");

		// A settled render clears the one-second repaint the partial started.
		mount(tool, outcome, {}, context);
	});
});

/** Register `/check` over a runtime. */
function commandFor(runtime: CheckRuntime) {
	const fake = makeFakePi();
	registerCheckCommand(fake.pi, runtime);
	return fake.commands.get("check");
}

/** Replace `ctx.ui.custom` with a mount loop, answered per screen index. */
function mountScreens(ctx: any, answer: (index: number, component: any) => void): () => number {
	let mounts = 0;
	ctx.ui.custom = async (factory: any) => {
		const index = mounts++;
		return await new Promise((resolve) => {
			const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, ctx.ui.theme, {}, resolve);
			answer(index, component);
		});
	};
	return () => mounts;
}

const PASS = (): CheckResult => result({ status: "passed", exitCode: 0, failures: [], tail: "" });
const FAIL = (): CheckResult => result({ status: "failed", exitCode: 1 });

describe("check command", () => {
	test("runs headless and reports a passing summary", async () => {
		const { runtime, seen } = runtimeFor(PASS());
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "print", hasUI: false, branch: [] }).ctx;

		await command.handler("", ctx);

		expect(seen).toEqual(["all"]);
		expect(ctx.notices.at(-1)?.message).toContain("Check passed");
	});

	test("reports a failing run headlessly with its failures", async () => {
		const { runtime } = runtimeFor(FAIL());
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "print", hasUI: false, branch: [] }).ctx;

		await command.handler("test", ctx);

		expect(ctx.notices.at(-1)?.message).toContain("src/a.ts:12");
	});

	test("rejects an unknown target", async () => {
		const { runtime, seen } = runtimeFor(PASS());
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "print", hasUI: false, branch: [] }).ctx;

		await command.handler("coverage", ctx);

		expect(seen).toEqual([]);
		expect(ctx.notices.at(-1)?.message).toContain("Unknown check target");
	});

	test("refuses in plan mode", async () => {
		const { runtime, seen } = runtimeFor(PASS());
		const command = commandFor(runtime);
		const ctx = fakeCtx({
			mode: "tui",
			branch: [{ type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } }],
		}).ctx;

		await command.handler("", ctx);

		expect(seen).toEqual([]);
		expect(ctx.notices.at(-1)?.message).toContain("Plan mode is read-only");
	});

	test("mounts the run screen and reports a pass in the TUI", async () => {
		const { runtime } = runtimeFor(PASS());
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;
		const mounts = mountScreens(ctx, () => {});

		await command.handler("", ctx);

		expect(mounts()).toBe(1);
		expect(ctx.notices.at(-1)?.message).toContain("Check passed");
	});

	test("mounts the result screen for a failed TUI run", async () => {
		const { runtime } = runtimeFor(FAIL());
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;
		const mounts = mountScreens(ctx, (index, component) => {
			if (index === 1) component.handleInput("\u001b");
		});

		await command.handler("", ctx);

		expect(mounts()).toBe(2);
		expect(ctx.notices).toHaveLength(0);
	});

	test("reports a cancelled TUI run", async () => {
		const { runtime } = runtimeFor(result({ status: "cancelled", exitCode: null, failures: [] }));
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;
		mountScreens(ctx, () => {});

		await command.handler("", ctx);

		expect(ctx.notices.at(-1)?.message).toContain("Check cancelled");
	});

	test("reports an error TUI run with the report", async () => {
		const { runtime } = runtimeFor(
			result({ status: "error", commands: [], exitCode: null, error: "No command detected" }),
		);
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;
		const mounts = mountScreens(ctx, () => {});

		await command.handler("", ctx);

		expect(mounts()).toBe(1);
		expect(ctx.notices.at(-1)?.message).toContain("Check failed to run: No command detected");
		expect(ctx.notices.at(-1)?.kind).toBe("error");
	});

	test("reruns from the result screen", async () => {
		const { runtime, seen } = runtimeFor((call) => (call === 0 ? FAIL() : PASS()));
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;
		const mounts = mountScreens(ctx, (index, component) => {
			if (index === 1) component.handleInput("r");
		});

		await command.handler("", ctx);

		expect(mounts()).toBe(3);
		expect(seen).toEqual(["all", "all"]);
		expect(ctx.notices.at(-1)?.message).toContain("Check passed");
	});

	test("reports a runtime that refuses to start", async () => {
		const runtime = {
			start: () => {
				throw new CheckError("A check is already running.");
			},
		} as unknown as CheckRuntime;
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;

		await command.handler("", ctx);

		expect(ctx.notices.at(-1)?.message).toContain("A check is already running.");
	});

	test("offers target completions", () => {
		const command = commandFor(runtimeFor(PASS()).runtime);
		const items = command.getArgumentCompletions("t");

		expect(items?.map((item: { value: string }) => item.value)).toEqual(["test ", "typecheck "]);
		expect(command.getArgumentCompletions("test extra")).toBeNull();
	});
});
