import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, normalizeConfig, PORT_BASE, PORT_RANGE, randomPort } from "./config.ts";

describe("randomPort", () => {
	test("stays inside the per-session range", () => {
		for (let draw = 0; draw < 200; draw++) {
			const port = randomPort();
			expect(port).toBeGreaterThanOrEqual(PORT_BASE);
			expect(port).toBeLessThan(PORT_BASE + PORT_RANGE);
		}
	});
});

describe("normalizeConfig port", () => {
	test("keeps the zero default that picks a per-session port", () => {
		expect(normalizeConfig(undefined).port).toBe(DEFAULT_CONFIG.port);
		expect(DEFAULT_CONFIG.port).toBe(0);
	});

	test("keeps and clamps an explicit port", () => {
		expect(normalizeConfig({ port: 8080 }).port).toBe(8080);
		expect(normalizeConfig({ port: 70000 }).port).toBe(65535);
	});
});

describe("normalizeConfig markdown", () => {
	test("defaults to rendering and accepts a boolean", () => {
		expect(DEFAULT_CONFIG.markdown).toBe(true);
		expect(normalizeConfig({ markdown: false }).markdown).toBe(false);
		expect(normalizeConfig({ markdown: "no" }).markdown).toBe(true);
	});
});

describe("normalizeConfig maxIndexEntries", () => {
	test("defaults and clamps to at least one", () => {
		expect(DEFAULT_CONFIG.maxIndexEntries).toBe(20000);
		expect(normalizeConfig({ maxIndexEntries: 5 }).maxIndexEntries).toBe(5);
		expect(normalizeConfig({ maxIndexEntries: 0 }).maxIndexEntries).toBe(1);
	});
});

describe("normalizeConfig git diff", () => {
	test("defaults the diff view on with three context lines", () => {
		expect(DEFAULT_CONFIG.gitDiff).toBe(true);
		expect(DEFAULT_CONFIG.diffContext).toBe(3);
		expect(DEFAULT_CONFIG.maxDiffLines).toBe(4000);
		expect(normalizeConfig(undefined).gitDiff).toBe(true);
	});

	test("accepts a boolean toggle and clamps the numeric keys", () => {
		expect(normalizeConfig({ gitDiff: false }).gitDiff).toBe(false);
		expect(normalizeConfig({ gitDiff: "no" }).gitDiff).toBe(true);
		expect(normalizeConfig({ diffContext: -2 }).diffContext).toBe(0);
		expect(normalizeConfig({ diffContext: 500 }).diffContext).toBe(100);
		expect(normalizeConfig({ maxDiffLines: 0 }).maxDiffLines).toBe(1);
	});
});
