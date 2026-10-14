import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, SHARED_CONFIG_FILE } from "../lib/config.ts";
import { tempDir } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import { migrate, migrateDocument, migrateScope, SCHEMA_URL } from "./migrate-config.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

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
		expect(document.$schema).toBe(SCHEMA_URL);
	});

	test("is idempotent on an already-migrated document", () => {
		const once = migrateDocument({ price: { currency: { symbol: "¥" } }, version: 1, $schema: SCHEMA_URL });
		const twice = migrateDocument(once.document);
		expect(twice.changed).toBe(false);
		expect(twice.document).toEqual(once.document);
	});
});

describe("migrateScope", () => {
	test("moves a legacy file into its section and deletes it", () => {
		const dir = scope();
		writeFileSync(join(dir, "jobs.json"), JSON.stringify({ maxJobs: 5 }));
		writeFileSync(join(dir, "memory.json"), JSON.stringify({ inject: false }));

		const result = migrateScope(dir);

		expect(result.moved).toHaveLength(2);
		expect(readJson(join(dir, SHARED_CONFIG_FILE))).toMatchObject({
			job: { maxJobs: 5 },
			memory: { inject: false },
			version: 1,
		});
		expect(existsSync(join(dir, "jobs.json"))).toBe(false);
		expect(existsSync(join(dir, "memory.json"))).toBe(false);
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
