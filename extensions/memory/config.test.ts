import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAgentDir } from "../../test/helpers/env.ts";
import { DEFAULT_MEMORY_CONFIG, loadMemoryConfig, normalizeMemoryConfig } from "./config.ts";

let cwd = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "pi-memory-cfg-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("normalizeMemoryConfig", () => {
	test("returns the base for a missing object", () => {
		expect(normalizeMemoryConfig(undefined, DEFAULT_MEMORY_CONFIG)).toEqual(DEFAULT_MEMORY_CONFIG);
	});

	test("clamps maxInjectBytes", () => {
		expect(normalizeMemoryConfig({ maxInjectBytes: 10 }, DEFAULT_MEMORY_CONFIG).maxInjectBytes).toBe(512);
		expect(normalizeMemoryConfig({ maxInjectBytes: 10_000_000 }, DEFAULT_MEMORY_CONFIG).maxInjectBytes).toBe(32768);
	});

	test("ignores an invalid inject flag", () => {
		expect(normalizeMemoryConfig({ inject: "no" }, DEFAULT_MEMORY_CONFIG).inject).toBe(true);
		expect(normalizeMemoryConfig({ inject: false }, DEFAULT_MEMORY_CONFIG).inject).toBe(false);
	});
});

describe("loadMemoryConfig", () => {
	test("merges the global file then the project file", () => {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "memory.json"), JSON.stringify({ maxInjectBytes: 1024 }));
		return withAgentDir((agentDir) => {
			writeFileSync(join(agentDir, "memory.json"), JSON.stringify({ inject: false }));
			const config = loadMemoryConfig(cwd);
			expect(config.inject).toBe(false);
			expect(config.maxInjectBytes).toBe(1024);
		});
	});

	test("ignores malformed files", () => {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "memory.json"), "{ not json");
		return withAgentDir(() => {
			expect(loadMemoryConfig(cwd)).toEqual(DEFAULT_MEMORY_CONFIG);
		});
	});
});
