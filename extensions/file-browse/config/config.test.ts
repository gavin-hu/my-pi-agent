/**
 * The browse config contract: defaults, booleans, integer clamps, and the
 * per-session port range. Every case is a raw object a typo could produce.
 */

import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, LIVE_INTERVAL_MAX, LIVE_INTERVAL_MIN, normalizeConfig, type ServeConfig } from "./config.ts";

interface NumericCase {
	key: keyof ServeConfig;
	raw: number;
	expected: number;
}

describe("normalizeConfig defaults", () => {
	test("keeps every default when the section is absent", () => {
		expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
	});

	test("defaults the server, the caps, the diff view, and live status", () => {
		expect(DEFAULT_CONFIG).toMatchObject({
			autoOpen: true,
			maxFileBytes: 1024 * 1024,
			maxThumbBytes: 5 * 1024 * 1024,
			maxTextLines: 5000,
			maxDirEntries: 2000,
			thumbnails: true,
			markdown: true,
			markdownHtml: true,
			maxIndexEntries: 20000,
			gitDiff: true,
			diffContext: 3,
			maxDiffLines: 4000,
			live: true,
			liveIntervalMs: 5000,
		});
	});
});

describe("normalizeConfig booleans", () => {
	const cases: Array<[keyof ServeConfig, string]> = [
		["autoOpen", "open the browser"],
		["thumbnails", "inline thumbnails"],
		["markdown", "rendered Markdown"],
		["markdownHtml", "sanitized raw HTML"],
		["gitDiff", "the diff view"],
		["live", "the live status channel"],
	];

	for (const [key, label] of cases) {
		test(`toggles ${label} only on a real boolean`, () => {
			expect(normalizeConfig({ [key]: false })[key]).toBe(false);
			expect(normalizeConfig({ [key]: true })[key]).toBe(true);
			expect(normalizeConfig({ [key]: "no" })[key]).toBe(DEFAULT_CONFIG[key]);
		});
	}
});

describe("normalizeConfig numeric clamps", () => {
	const cases: NumericCase[] = [
		{ key: "maxFileBytes", raw: 4096, expected: 4096 },
		{ key: "maxFileBytes", raw: -1, expected: 0 },
		{ key: "maxThumbBytes", raw: 2048, expected: 2048 },
		{ key: "maxThumbBytes", raw: -1, expected: 0 },
		{ key: "maxTextLines", raw: 50, expected: 50 },
		{ key: "maxTextLines", raw: 0, expected: 1 },
		{ key: "maxDirEntries", raw: 10, expected: 10 },
		{ key: "maxDirEntries", raw: 0, expected: 1 },
		{ key: "maxIndexEntries", raw: 5, expected: 5 },
		{ key: "maxIndexEntries", raw: 0, expected: 1 },
		{ key: "diffContext", raw: 1, expected: 1 },
		{ key: "diffContext", raw: -2, expected: 0 },
		{ key: "diffContext", raw: 500, expected: 100 },
		{ key: "maxDiffLines", raw: 10, expected: 10 },
		{ key: "maxDiffLines", raw: 0, expected: 1 },
		{ key: "liveIntervalMs", raw: 1000, expected: 1000 },
		{ key: "liveIntervalMs", raw: 1, expected: LIVE_INTERVAL_MIN },
		{ key: "liveIntervalMs", raw: LIVE_INTERVAL_MAX * 10, expected: LIVE_INTERVAL_MAX },
	];

	for (const { key, raw, expected } of cases) {
		test(`clamps ${key}=${raw} to ${expected}`, () => {
			expect(normalizeConfig({ [key]: raw })[key]).toBe(expected);
		});
	}
});

describe("normalizeConfig layering", () => {
	test("applies a raw section over an explicit base", () => {
		const base: ServeConfig = { ...DEFAULT_CONFIG, markdown: false, maxTextLines: 10 };
		const normalized = normalizeConfig({ maxTextLines: 4, thumbnails: false }, base);
		expect(normalized.thumbnails).toBe(false);
		expect(normalized.maxTextLines).toBe(4);
		expect(normalized.markdown).toBe(false);
	});
});
