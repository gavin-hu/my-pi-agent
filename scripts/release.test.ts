/**
 * Release and configuration tooling.
 *
 * Covers the changelog section extractor the release workflow publishes, the
 * peer-version report the compat job writes, and the one-time migration into the
 * shared `bytefly.json`. The guards are exact version-heading matching, a missing
 * peer as an error rather than a blank row, and a migration that stamps a version
 * without resetting one already present.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { readJson, SHARED_CONFIG_FILE } from "../lib/config.ts";
import { tempDir } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import { LEGACY_FILES, migrate, migrateDocument, migrateScope } from "./migrate-config.ts";
import { formatSummary, formatVersions, peerVersions } from "./peer-versions.ts";
import { changelogSection } from "./release-notes.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/**
 * A miniature changelog with the same shape as the real one: an `Unreleased`
 * heading, two dated releases, and the link references at the bottom.
 */
const MARKDOWN = [
	"# Changelog",
	"",
	"## [Unreleased]",
	"",
	"### Added",
	"",
	"- work in progress",
	"",
	"## [1.2.0] - 2026-01-02",
	"",
	"### Added",
	"",
	"- the newer feature",
	"",
	"## [1.1.0] - 2026-01-01",
	"",
	"### Fixed",
	"",
	"- the older fix",
	"",
	"## [1.0.0] - 2025-12-31",
	"",
	"- the first release",
	"",
	"[Unreleased]: https://example.com/compare/v1.2.0...HEAD",
	"[1.2.0]: https://example.com/compare/v1.1.0...v1.2.0",
	"",
].join("\n");

describe("changelog sections", () => {
	test("returns the section with its heading", () => {
		const section = changelogSection(MARKDOWN, "1.2.0");
		expect(section).toBe("## [1.2.0] - 2026-01-02\n\n### Added\n\n- the newer feature\n");
	});

	test("extracts the last section up to the link references", () => {
		const section = changelogSection(MARKDOWN, "1.0.0");
		expect(section).toBe("## [1.0.0] - 2025-12-31\n\n- the first release\n");
	});

	test("reads the Unreleased section", () => {
		expect(changelogSection(MARKDOWN, "Unreleased")).toBe("## [Unreleased]\n\n### Added\n\n- work in progress\n");
	});

	test("matches the heading exactly, not a longer version", () => {
		const markdown = "## [1.2.0] - 2026-01-02\n\nbody\n";
		expect(changelogSection(markdown, "1.2")).toBeUndefined();
		expect(changelogSection(markdown, "1.2.0.1")).toBeUndefined();
		expect(changelogSection(markdown, "1.2.0")).not.toBeUndefined();
	});

	test("returns undefined for a version that is absent", () => {
		expect(changelogSection(MARKDOWN, "9.9.9")).toBeUndefined();
	});

	test("ends the output with exactly one newline", () => {
		const section = changelogSection(MARKDOWN, "1.2.0");
		expect(section?.endsWith("\n\n")).toBe(false);
		expect(section?.endsWith("\n")).toBe(true);
	});
});

/** A throwaway tree with the given peers installed at their versions. */
function peerTree(peers: Record<string, string | undefined>): string {
	const dir = temps.track(tempDir("pi-peer-versions-"));
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ peerDependencies: Object.fromEntries(Object.keys(peers).map((name) => [name, "*"])) }),
	);
	for (const [name, version] of Object.entries(peers)) {
		if (version === undefined) continue;
		const packageDir = join(dir, "node_modules", name);
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name, version }));
	}
	return dir;
}

describe("peer versions", () => {
	test("reads each declared peer's installed version, in name order", () => {
		const dir = peerTree({ typebox: "1.3.27", "@earendil-works/pi-tui": "1.4.0" });
		expect(peerVersions(dir)).toEqual([
			{ name: "@earendil-works/pi-tui", version: "1.4.0" },
			{ name: "typebox", version: "1.3.27" },
		]);
	});

	test("names a peer that is not installed instead of skipping it", () => {
		const dir = peerTree({ typebox: undefined });
		expect(() => peerVersions(dir)).toThrow(/typebox is not installed/);
	});

	test("rejects an installed peer that declares no version", () => {
		const dir = peerTree({ typebox: undefined });
		const packageDir = join(dir, "node_modules", "typebox");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "typebox" }));
		expect(() => peerVersions(dir)).toThrow(/typebox declares no version/);
	});
});

describe("peer version formatting", () => {
	const versions = [
		{ name: "@earendil-works/pi-coding-agent", version: "1.4.0" },
		{ name: "typebox", version: "1.3.27" },
	];

	test("aligns one line per peer", () => {
		expect(formatVersions(versions)).toEqual([
			"@earendil-works/pi-coding-agent  1.4.0",
			"typebox                          1.3.27",
		]);
	});

	test("summarizes the same list as a markdown table", () => {
		const summary = formatSummary(versions);
		expect(summary).toContain("| Package | Version |");
		expect(summary).toContain("| `typebox` | 1.3.27 |");
		expect(summary.endsWith("\n")).toBe(true);
	});
});

/** A fresh scope directory. */
function scope(): string {
	return temps.track(tempDir("migrate-scope-"));
}

describe("migrateDocument", () => {
	test("moves bytefly's top-level price keys under price", () => {
		const { document, changed } = migrateDocument({
			currency: { symbol: "¥" },
			rates: { "a/b": {} },
			notify: { enabled: true },
		});
		expect(changed).toBe(true);
		expect(document.price).toEqual({ currency: { symbol: "¥" }, rates: { "a/b": {} } });
		expect(document.notify).toEqual({ enabled: true });
		expect("currency" in document).toBe(false);
		expect(document.version).toBe(1);
		// The document carries no schema pointer: `assets/bytefly.schema.json` is gone.
		expect(document.$schema).toBeUndefined();
	});

	test("leaves a hand-written $schema alone and does not add one", () => {
		const { document } = migrateDocument({ $schema: "https://example.test/meta.json" });
		expect(document.$schema).toBe("https://example.test/meta.json");
	});

	test("keeps a version the document already carries", () => {
		const { document, changed } = migrateDocument({ version: 2 });
		expect(document.version).toBe(2);
		expect(changed).toBe(false);
	});

	test("is idempotent on an already-migrated document", () => {
		const once = migrateDocument({ price: { currency: { symbol: "¥" } }, version: 1 });
		const twice = migrateDocument(once.document);
		expect(twice.changed).toBe(false);
		expect(twice.document).toEqual(once.document);
	});
});

describe("migrateScope", () => {
	test("moves every declared legacy file into its section and deletes it", () => {
		const dir = scope();
		for (const [file, section] of LEGACY_FILES) {
			writeFileSync(join(dir, file), JSON.stringify({ marker: section }));
		}

		const result = migrateScope(dir);

		expect(result.moved).toHaveLength(LEGACY_FILES.length);
		const document = readJson(join(dir, SHARED_CONFIG_FILE));
		for (const [file, section] of LEGACY_FILES) {
			expect(document?.[section], file).toEqual({ marker: section });
			expect(existsSync(join(dir, file)), file).toBe(false);
		}
		expect(document?.version).toBe(1);
	});

	test("is idempotent: a second run moves nothing", () => {
		const dir = scope();
		writeFileSync(join(dir, "jobs.json"), JSON.stringify({ maxJobs: 5 }));
		migrateScope(dir);
		const second = migrateScope(dir);
		expect(second.moved).toEqual([]);
		expect(second.wrote).toBe(false);
	});

	test("dry run reports but writes and deletes nothing", () => {
		const dir = scope();
		writeFileSync(join(dir, "jobs.json"), JSON.stringify({ maxJobs: 5 }));

		const result = migrateScope(dir, { dryRun: true });

		expect(result.moved).toHaveLength(1);
		expect(result.wrote).toBe(true);
		expect(existsSync(join(dir, SHARED_CONFIG_FILE))).toBe(false);
		expect(existsSync(join(dir, "jobs.json"))).toBe(true);
	});

	test("keep migrates the value but leaves the legacy file", () => {
		const dir = scope();
		writeFileSync(join(dir, "jobs.json"), JSON.stringify({ maxJobs: 5 }));

		migrateScope(dir, { keep: true });

		expect(readJson(join(dir, SHARED_CONFIG_FILE))?.job).toEqual({ maxJobs: 5 });
		expect(existsSync(join(dir, "jobs.json"))).toBe(true);
	});

	test("skips a legacy file when the section is already present", () => {
		const dir = scope();
		writeFileSync(join(dir, SHARED_CONFIG_FILE), JSON.stringify({ job: { maxJobs: 1 } }));
		writeFileSync(join(dir, "jobs.json"), JSON.stringify({ maxJobs: 9 }));

		const result = migrateScope(dir);

		expect(result.moved).toEqual([]);
		expect(result.skipped).toHaveLength(1);
		expect(readJson(join(dir, SHARED_CONFIG_FILE))?.job).toEqual({ maxJobs: 1 });
		expect(existsSync(join(dir, "jobs.json"))).toBe(true);
	});

	test("names a malformed legacy file and leaves it alone", () => {
		const dir = scope();
		writeFileSync(join(dir, "jobs.json"), "{ not json");

		const result = migrateScope(dir);

		expect(result.moved).toEqual([]);
		expect(result.errors).toHaveLength(1);
		expect(existsSync(join(dir, "jobs.json"))).toBe(true);
	});

	test("refuses to touch a malformed shared document", () => {
		const dir = scope();
		writeFileSync(join(dir, SHARED_CONFIG_FILE), "{ not json");
		writeFileSync(join(dir, "jobs.json"), JSON.stringify({ maxJobs: 5 }));

		const result = migrateScope(dir);

		expect(result.errors).toHaveLength(1);
		expect(result.moved).toEqual([]);
		expect(existsSync(join(dir, "jobs.json"))).toBe(true);
	});

	test("renames the document section to file-read", () => {
		const dir = scope();
		writeFileSync(join(dir, SHARED_CONFIG_FILE), JSON.stringify({ document: { maxChars: 1000 } }));

		const result = migrateScope(dir);

		expect(result.moved).toEqual([`${SHARED_CONFIG_FILE}#document -> #file-read`]);
		expect(readJson(join(dir, SHARED_CONFIG_FILE))).toMatchObject({ "file-read": { maxChars: 1000 }, version: 1 });
		expect("document" in (readJson(join(dir, SHARED_CONFIG_FILE)) ?? {})).toBe(false);
	});

	test("keeps an existing file-read section and reports the old one", () => {
		const dir = scope();
		writeFileSync(
			join(dir, SHARED_CONFIG_FILE),
			JSON.stringify({ document: { maxChars: 1000 }, "file-read": { maxChars: 2000 } }),
		);

		const result = migrateScope(dir);

		expect(result.moved).toEqual([]);
		expect(result.skipped).toHaveLength(1);
		expect(readJson(join(dir, SHARED_CONFIG_FILE))?.["file-read"]).toEqual({ maxChars: 2000 });
	});
});

describe("migrate", () => {
	test("covers both the global and project scopes", () => {
		const agentDir = scope();
		const projectDir = scope();
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
		writeFileSync(join(agentDir, "memory.json"), JSON.stringify({ inject: false }));
		writeFileSync(join(projectDir, ".pi", "jobs.json"), JSON.stringify({ maxJobs: 9 }));

		const results = migrate({ agentDir, projectDir });

		expect(results[0]?.moved).toHaveLength(1);
		expect(results[1]?.moved).toHaveLength(1);
		expect(readJson(join(agentDir, SHARED_CONFIG_FILE))?.memory).toEqual({ inject: false });
		expect(readJson(join(projectDir, ".pi", SHARED_CONFIG_FILE))?.job).toEqual({ maxJobs: 9 });
	});
});
