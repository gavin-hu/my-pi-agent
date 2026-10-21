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
function cleanLine(text: string): string {
	return stripControlChars(text.replace(/\r/g, "")).trim();
}

/** Whether a candidate looks like a path rather than prose or a URL. */
function looksLikePath(path: string): boolean {
	if (path === "" || path.startsWith("http://") || path.startsWith("https://")) return false;
	return path.includes("/") || path.includes("\\") || path.includes(".");
}

/** A number from a regex group, or undefined when the group did not match. */
function numberFrom(group: string | undefined): number | undefined {
	return group === undefined ? undefined : Number.parseInt(group, 10);
}

/**
 * A failure at a parsed location, or undefined when the path is not a path the
 * extension is willing to point at. A column is kept only when it parsed, so a
 * two-part location never carries a `NaN`.
 */
function locatedFailure(
	path: string,
	line: number | undefined,
	column: number | undefined,
	rest: Pick<Failure, "message" | "command"> & { test?: string },
): Failure | undefined {
	if (!looksLikePath(path) || line === undefined || !Number.isFinite(line)) return undefined;
	const known = column !== undefined && Number.isFinite(column) ? column : undefined;
	return { path, line, ...(known === undefined ? {} : { column: known }), ...rest };
}

/** The generic compiler/linter location: `path:line(:col): message`. */
function genericFailure(line: string, command: string): Failure | undefined {
	const match = /^(.*?):(\d+)(?::(\d+))?:\s*(.+)$/.exec(line);
	if (!match) return undefined;
	const path = match[1]?.trim() ?? "";
	const message = match[4]?.trim() ?? "";
	if (message === "") return undefined;
	if (path.startsWith("at ") || path.startsWith("thread ")) return undefined;
	return locatedFailure(path, numberFrom(match[2]), numberFrom(match[3]), { message, command });
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
	return locatedFailure(path, numberFrom(match[2]), numberFrom(match[3]), {
		...(pendingTest ? { test: pendingTest } : {}),
		message: pendingTest ? "Test failed" : "Stack frame",
		command,
	});
}

/** Python's `File "path", line N, in test` traceback line. */
function pythonTraceback(line: string, command: string, pendingTest: string | undefined): Failure | undefined {
	const match = /^File "(.+)", line (\d+)/.exec(line);
	if (!match) return undefined;
	const path = match[1]?.trim() ?? "";
	return locatedFailure(path, numberFrom(match[2]), undefined, {
		...(pendingTest ? { test: pendingTest } : {}),
		message: pendingTest ? "Test failed" : "Traceback",
		command,
	});
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
	return locatedFailure(path, numberFrom(match[3]), numberFrom(match[4]), {
		test: match[1],
		message: "Panicked",
		command,
	});
}

/**
 * Stable identity for dedupe. The command joins the key only when two commands'
 * failures must not merge, which is the cross-command pass in `runtime.ts`.
 */
export function failureKey(failure: Failure, options: { command?: boolean } = {}): string {
	const fields: Array<string | number | undefined> = [failure.path, failure.line, failure.column, failure.test];
	if (options.command) fields.push(failure.command);
	fields.push(failure.message);
	return fields.map((field) => field ?? "").join("\u0000");
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
			message: cleanLine(failure.message),
			...(failure.test ? { test: cleanLine(failure.test) } : {}),
			...(failure.path ? { path: cleanLine(failure.path) } : {}),
		};
		if (!normalized.message) return;
		const key = failureKey(normalized);
		if (seen.has(key)) return;
		seen.add(key);
		if (failures.length < MAX_FAILURES) failures.push(normalized);
	};

	for (const raw of output.split("\n")) {
		const line = cleanLine(raw);
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
