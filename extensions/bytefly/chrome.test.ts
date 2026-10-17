import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";
import { createFakePi, emit } from "../../test/helpers/fakes.ts";
import {
	createRailSource,
	DEFAULT_CHROME_CONFIG,
	DEFAULT_RAIL_GLYPH,
	loadChromeConfig,
	normalizeChromeConfig,
	RAIL_ROLES,
	registerChrome,
} from "./chrome.ts";

describe("RAIL_ROLES", () => {
	test("keeps a finished rail neutral and only warns or fails in colour", () => {
		expect(RAIL_ROLES.ok).toBe("faint");
		expect(RAIL_ROLES.info).toBe("info");
		expect(RAIL_ROLES.warn).toBe("warn");
		expect(RAIL_ROLES.bad).toBe("bad");
	});
});

describe("normalizeChromeConfig", () => {
	test("returns the base for missing input and accepts a one-column glyph", () => {
		expect(normalizeChromeConfig(undefined, DEFAULT_CHROME_CONFIG)).toEqual(DEFAULT_CHROME_CONFIG);
		expect(normalizeChromeConfig({ rail: "│" }, DEFAULT_CHROME_CONFIG).rail).toBe("│");
		expect(normalizeChromeConfig({ rail: "❘" }, DEFAULT_CHROME_CONFIG).rail).toBe("❘");
	});

	test("falls back on a wide, emoji, multi-glyph, empty, or control value", () => {
		for (const bad of ["中", "🚀", "ab", "", "  ", "\u001b"]) {
			expect(normalizeChromeConfig({ rail: bad }, DEFAULT_CHROME_CONFIG).rail).toBe(DEFAULT_RAIL_GLYPH);
		}
	});
});

describe("loadChromeConfig", () => {
	test("returns the defaults when no files exist", async () => {
		await withAgentDir(() => {
			expect(loadChromeConfig(tempDir("chrome-repo-"))).toEqual(DEFAULT_CHROME_CONFIG);
		}, "chrome-global-");
	});

	test("merges global then project, with project winning", async () => {
		const repo = tempDir("chrome-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ chrome: { rail: "│" } }));
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), JSON.stringify({ chrome: { rail: "❘" } }));
			expect(loadChromeConfig(repo).rail).toBe("│");
		}, "chrome-global-");
	});

	test("ignores malformed files", async () => {
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), "{ not json");
			expect(loadChromeConfig(tempDir("chrome-repo-"))).toEqual(DEFAULT_CHROME_CONFIG);
		}, "chrome-global-");
	});
});

describe("createRailSource", () => {
	test("starts at the default and follows a valid glyph", () => {
		const rail = createRailSource();
		expect(rail.resolve()).toBe(DEFAULT_RAIL_GLYPH);
		rail.set("│");
		expect(rail.resolve()).toBe("│");
	});

	test("keeps the previous glyph when the next value is not one column", () => {
		const rail = createRailSource("│");
		rail.set("🚀");
		expect(rail.resolve()).toBe("│");
	});
});

describe("registerChrome", () => {
	test("loads the glyph when a session starts and when the tree changes", async () => {
		const repo = tempDir("chrome-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ chrome: { rail: "│" } }));
		await withAgentDir(async () => {
			const fake = createFakePi();
			const rail = registerChrome(fake.pi);
			expect(rail.resolve()).toBe(DEFAULT_RAIL_GLYPH);
			await emit(fake.pi, "session_start", {}, { cwd: repo, mode: "tui" });
			expect(rail.resolve()).toBe("│");
			rail.set(DEFAULT_RAIL_GLYPH);
			await emit(fake.pi, "session_tree", {}, { cwd: repo, mode: "tui" });
			expect(rail.resolve()).toBe("│");
		}, "chrome-global-");
	});
});
