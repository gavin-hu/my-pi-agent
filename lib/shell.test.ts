import { describe, expect, test } from "bun:test";
import { hasShellEscape, isShellEscapable, SHELL_ESCAPABLE } from "./shell.ts";

describe("isShellEscapable", () => {
	const escapable = [" ", "\t", "\n", "'", '"', "\\", "$", "`", ";", "&", "|", "<", ">", "(", ")", "{", "}", "[", "]"];
	for (const char of escapable) {
		test(`is true for ${JSON.stringify(char)}`, () => {
			expect(isShellEscapable(char)).toBe(true);
		});
	}

	for (const char of ["a", "p", ":", ".", "0"]) {
		test(`is false for ${JSON.stringify(char)}`, () => {
			expect(isShellEscapable(char)).toBe(false);
		});
	}

	test("is false for the empty string", () => {
		expect(isShellEscapable("")).toBe(false);
	});
});

describe("hasShellEscape", () => {
	const plain = ["git status", "git diff -- extensions\\plan", "git log --format='%h\\t%s'", "a\\b"];
	for (const command of plain) {
		test(`is false for ${JSON.stringify(command)}`, () => {
			expect(hasShellEscape(command)).toBe(false);
		});
	}

	const escaped = [
		"git status \\; rm -rf x",
		"git status \\& rm",
		"git status \\| sh",
		"git diff -- C:\\repo\\\\",
		"git status \\",
	];
	for (const command of escaped) {
		test(`is true for ${JSON.stringify(command)}`, () => {
			expect(hasShellEscape(command)).toBe(true);
		});
	}
});

describe("SHELL_ESCAPABLE", () => {
	test("is not global, so .test cannot carry lastIndex state between calls", () => {
		expect(SHELL_ESCAPABLE.global).toBe(false);
	});
});
