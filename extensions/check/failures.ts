/**
 * Best-effort failure extraction from a check command's output.
 *
 * Known runner lines (pytest, Go, Cargo, Vitest/Jest) are recognized first; the
 * generic `path:line(:col): message` parser is the fallback, so any compiler or
 * linter with a conventional location works without a runner-specific parser.
 * A miss is never guessed at: the caller falls back to a bounded tail with the
 * command's exit status.
 */

import { stripControlChars } from "../../lib/format.ts";
import type { Failure } from "./types.ts";

/** Failures retained from one command; the model list is capped lower. */
const MAX_FAILURES = 200;

/** One clean line, without control characters or a trailing CR. */
function lineOf(text: string): string {
	return stripControlChars(text.replace(/\r/g, "")).trim();
}

/** Whether a candidate looks like a path rather than prose or a URL. */
function looksLikePath(path: string): boolean {
	if (path === "" || path.startsWith("http://") || path.startsWith("https://")) return false;
	return path.includes("/") || path.includes("\\") || path.includes(".");
}

/** The generic compiler/linter location: `path:line(:col): message`. */
function genericFailure(line: string, command: string): Failure | undefined {
	const match = /^(.*?):(\d+)(?::(\d+))?:\s*(.+)$/.exec(line);
	if (!match) return undefined;
	const path = match[1]?.trim() ?? "";
	const lineNumber = Number.parseInt(match[2] ?? "", 10);
	const column = match[3] === undefined ? undefined : Number.parseInt(match[3], 10);
	const message = match[4]?.trim() ?? "";
	if (!looksLikePath(path) || !Number.isFinite(lineNumber) || message === "") return undefined;
	if (path.startsWith("at ") || path.startsWith("thread ")) return undefined;
	return {
		path,
		line: lineNumber,
		...(column === undefined || !Number.isFinite(column) ? {} : { column }),
		message,
		command,
	};
}

/** Pytest's `FAILED path::test - message` line. */
function pytestFailure(line: string, command: string): Failure | undefined {
	const match = /^FAILED\s+(.+?)::(\S+)(?:\s+-\s+(.*))?$/.exec(line);
	if (!match) return undefined;
	const path = match[1]?.trim() ?? "";
	const test = match[2]?.trim() ?? "";
	const message = match[3]?.trim() || "Test failed";
	if (!path || !test) return undefined;
	return { path, test, message, command };
}

/** Vitest/Jest's `FAIL path > suite > test` line. */
function failLine(rest: string, command: string): Failure | undefined {
	const match = /^\s*FAIL\s+(.+?)(?:\s+>\s+.*)?$/.exec(rest);
	if (!match) return undefined;
	const path = match[1]?.trim() ?? "";
	if (!looksLikePath(path)) return undefined;
	return { path, message: "Test failed", command };
}

/** Jest/Vitest's `● suite > test` name; the next located frame attaches it. */
function testName(line: string): string | undefined {
	const match = /^●\s+(.+)$/.exec(line);
	return match?.[1]?.trim() || undefined;
}

/** A stack frame with a real location: `at … (path:line:col)` or `at path:line:col`. */
function stackFailure(line: string, command: string, pendingTest: string | undefined): Failure | undefined {
	const parenthesized = /^\s*at\s+.*?\((.+?):(\d+)(?::(\d+))?\)\s*$/.exec(line);
	const bare = parenthesized ? undefined : /^\s*at\s+(.+?):(\d+)(?::(\d+))?\s*$/.exec(line);
	const match = parenthesized ?? bare;
	if (!match) return undefined;
	const path = match[1]?.trim() ?? "";
	const lineNumber = Number.parseInt(match[2] ?? "", 10);
	const column = match[3] === undefined ? undefined : Number.parseInt(match[3], 10);
	if (!looksLikePath(path) || !Number.isFinite(lineNumber)) return undefined;
	return {
		path,
		line: lineNumber,
		...(column === undefined || !Number.isFinite(column) ? {} : { column }),
		...(pendingTest ? { test: pendingTest } : {}),
		message: pendingTest ? "Test failed" : "Stack frame",
		command,
	};
}

/** Python's `File "path", line N, in test` traceback line. */
function pythonTraceback(line: string, command: string, pendingTest: string | undefined): Failure | undefined {
	const match = /^File "(.+)", line (\d+)/.exec(line);
	if (!match) return undefined;
	const path = match[1]?.trim() ?? "";
	const lineNumber = Number.parseInt(match[2] ?? "", 10);
	if (!looksLikePath(path) || !Number.isFinite(lineNumber)) return undefined;
	return {
		path,
		line: lineNumber,
		...(pendingTest ? { test: pendingTest } : {}),
		message: pendingTest ? "Test failed" : "Traceback",
		command,
	};
}

/** Go's `--- FAIL: TestName` line; the next location attaches to it. */
function goFailure(line: string, command: string): Failure | undefined {
	const match = /^--- FAIL:\s+(\S+)/.exec(line);
	if (!match) return undefined;
	return { test: match[1] ?? "test", message: "Test failed", command };
}

/** Cargo's `thread 'test' panicked at path:line:col:` line. */
function cargoFailure(line: string, command: string): Failure | undefined {
	const match = /^thread '(.+)' panicked at (.+?):(\d+)(?::(\d+))?:$/.exec(line);
	if (!match) return undefined;
	const path = match[2]?.trim() ?? "";
	const lineNumber = Number.parseInt(match[3] ?? "", 10);
	if (!looksLikePath(path) || !Number.isFinite(lineNumber)) return undefined;
	const column = match[4] === undefined ? undefined : Number.parseInt(match[4], 10);
	return {
		path,
		line: lineNumber,
		...(column === undefined || !Number.isFinite(column) ? {} : { column }),
		test: match[1] ?? undefined,
		message: "Panicked",
		command,
	};
}

/** Stable identity for dedupe. */
function keyOf(failure: Failure): string {
	return [failure.path ?? "", failure.line ?? "", failure.column ?? "", failure.test ?? "", failure.message].join(
		"\u0000",
	);
}

/**
 * Parse the failures in one command's bounded output.
 *
 * A passing command has no failures even if a warning matched; parsing is only
 * used after a non-zero exit. A failed command with no recognizable failure
 * gets one honest fallback instead of an invented location.
 */
export function parseFailures(output: string, command: string, exitCode: number | null): Failure[] {
	if (exitCode === 0) return [];
	const failures: Failure[] = [];
	const seen = new Set<string>();
	let pendingTest: string | undefined;

	const add = (failure: Failure | undefined): void => {
		if (!failure) return;
		const normalized: Failure = {
			...failure,
			message: lineOf(failure.message),
			...(failure.test ? { test: lineOf(failure.test) } : {}),
			...(failure.path ? { path: lineOf(failure.path) } : {}),
		};
		if (!normalized.message) return;
		const key = keyOf(normalized);
		if (seen.has(key)) return;
		seen.add(key);
		if (failures.length < MAX_FAILURES) failures.push(normalized);
	};

	for (const raw of output.split("\n")) {
		const line = lineOf(raw);
		if (!line) continue;

		const test = testName(line);
		if (test) {
			pendingTest = test;
			continue;
		}

		const go = goFailure(line, command);
		if (go) {
			pendingTest = go.test;
			add(go);
			continue;
		}

		const stack = stackFailure(line, command, pendingTest);
		if (stack) {
			add(stack);
			pendingTest = undefined;
			continue;
		}

		const python = pythonTraceback(line, command, pendingTest);
		if (python) {
			add(python);
			pendingTest = undefined;
			continue;
		}

		const cargo = cargoFailure(line, command);
		if (cargo) {
			add(cargo);
			continue;
		}

		const pytest = pytestFailure(line, command);
		if (pytest) {
			add(pytest);
			continue;
		}

		const failed = failLine(line, command);
		if (failed) {
			add(failed);
			continue;
		}

		const generic = genericFailure(line, command);
		if (generic) {
			add(pendingTest ? { ...generic, test: pendingTest } : generic);
			pendingTest = undefined;
		}
	}

	if (failures.length > 0) return failures;
	return [
		{ message: exitCode === null ? "Command did not exit cleanly" : `Command exited with status ${exitCode}`, command },
	];
}
