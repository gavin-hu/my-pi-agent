import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getPiInvocation, type PiRuntime } from "./pi-invocation.ts";

/** A path that exists, standing in for Pi's own entry script. */
const SCRIPT = join(import.meta.dir, "pi-invocation.test.ts");

/** Process facts, defaulting to a plain Node run of the entry script. */
function runtime(overrides: Partial<PiRuntime> = {}): PiRuntime {
	return { execPath: "/usr/local/bin/node", entryScript: SCRIPT, ...overrides };
}

describe("getPiInvocation", () => {
	test("reuses the interpreter and the entry script it was started with", () => {
		expect(getPiInvocation(["--version"], runtime())).toEqual({
			command: "/usr/local/bin/node",
			args: [SCRIPT, "--version"],
		});
	});

	test("falls back to pi on PATH when the runtime was given no script", () => {
		expect(getPiInvocation(["--version"], runtime({ entryScript: undefined }))).toEqual({
			command: "pi",
			args: ["--version"],
		});
	});

	test("skips a script path that does not exist", () => {
		expect(getPiInvocation([], runtime({ entryScript: join(import.meta.dir, "no-such-file.ts") }))).toEqual({
			command: "pi",
			args: [],
		});
	});

	test("skips a bundled Bun script, which no other process can run", () => {
		const bundled = runtime({ execPath: "/usr/local/bin/bun", entryScript: "/$bunfs/root/pi" });
		expect(getPiInvocation([], bundled)).toEqual({ command: "pi", args: [] });
	});

	test("re-executes a standalone pi instead of reading a user argument as a script", () => {
		const standalone = runtime({ execPath: "/usr/local/bin/pi", entryScript: "notes.md" });
		expect(getPiInvocation(["notes.md"], standalone)).toEqual({
			command: "/usr/local/bin/pi",
			args: ["notes.md"],
		});
	});

	test("treats a compiled Bun build as standalone whatever the binary is called", () => {
		const compiled = runtime({ execPath: "/opt/homebrew/bin/my-pi", entryScript: undefined, bunVersion: "1.4.3" });
		expect(getPiInvocation([], compiled)).toEqual({ command: "/opt/homebrew/bin/my-pi", args: [] });
	});

	test("still reuses the script for an interpreter under another name", () => {
		expect(getPiInvocation([], runtime({ execPath: "/usr/bin/nodejs" }))).toEqual({
			command: "/usr/bin/nodejs",
			args: [SCRIPT],
		});
	});
});
