import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../test/helpers/env.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import {
	isFresh,
	readUpdateCache,
	UPDATE_CACHE_FILE,
	UPDATE_CACHE_TTL_MS,
	updateCacheKey,
	updateCachePath,
	writeUpdateCache,
	type UpdateCacheEntry,
} from "./cache.ts";
import type { PackageUpdate } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A file in a fresh temp directory, with the parent created. */
function tempFile(contents?: string): string {
	const dir = temps.track(tempDir("bytefly-update-cache-"));
	mkdirSync(dir, { recursive: true });
	const path = join(dir, UPDATE_CACHE_FILE);
	if (contents !== undefined) writeFileSync(path, contents);
	return path;
}

const UPDATES: PackageUpdate[] = [
	{ source: "@gavin-hu/my-pi-agent", displayName: "@gavin-hu/my-pi-agent", type: "npm", scope: "user" },
];
const entry: UpdateCacheEntry = {
	key: "cwd-and-packages",
	checkedAt: 1_767_225_600_000,
	updates: UPDATES,
	latest: "0.13.0",
};

describe("updateCachePath", () => {
	test("sits under the agent directory's bytefly folder", () => {
		expect(updateCachePath("/agent")).toBe(join("/agent", "bytefly", UPDATE_CACHE_FILE));
	});
});

describe("updateCacheKey", () => {
	test("is stable for the same cwd and package list", () => {
		expect(updateCacheKey("/repo", ["a", "b"])).toBe(updateCacheKey("/repo", ["a", "b"]));
	});

	test("changes with the cwd or the package list", () => {
		const base = updateCacheKey("/repo", ["a", "b"]);
		expect(updateCacheKey("/other", ["a", "b"])).not.toBe(base);
		expect(updateCacheKey("/repo", ["a", "c"])).not.toBe(base);
	});
});

describe("readUpdateCache", () => {
	test("round-trips what writeUpdateCache wrote", () => {
		const path = tempFile();
		writeUpdateCache(path, entry);
		expect(readUpdateCache(path)).toEqual(entry);
	});

	test("reads an absent file as a miss", () => {
		expect(readUpdateCache(tempFile())).toBeUndefined();
	});

	test("reads corrupt JSON as a miss", () => {
		expect(readUpdateCache(tempFile("{ not json"))).toBeUndefined();
	});

	test("rejects the old one-version schema", () => {
		expect(readUpdateCache(tempFile(JSON.stringify({ latest: "0.13.0", checkedAt: 1 })))).toBeUndefined();
	});

	test("rejects a missing key or timestamp, and a malformed update row", () => {
		for (const payload of [
			{ updates: UPDATES, checkedAt: 1 },
			{ key: "k", updates: UPDATES },
			{ key: "k", updates: [{ displayName: "x" }], checkedAt: 1 },
			{ key: "k", updates: UPDATES, checkedAt: "yesterday" },
			[],
		]) {
			expect(readUpdateCache(tempFile(JSON.stringify(payload))), JSON.stringify(payload)).toBeUndefined();
		}
	});

	test("drops a version that does not parse but keeps the list", () => {
		const path = tempFile(JSON.stringify({ key: "k", updates: UPDATES, checkedAt: 5, latest: "newest" }));
		expect(readUpdateCache(path)).toEqual({ key: "k", updates: UPDATES, checkedAt: 5 });
	});

	test("accepts an empty list", () => {
		const path = tempFile(JSON.stringify({ key: "k", updates: [], checkedAt: 5 }));
		expect(readUpdateCache(path)).toEqual({ key: "k", updates: [], checkedAt: 5 });
	});
});

describe("writeUpdateCache", () => {
	test("creates the directory it needs", () => {
		const dir = temps.track(tempDir("bytefly-update-cache-"));
		const path = updateCachePath(dir);
		writeUpdateCache(path, entry);
		expect(readUpdateCache(path)).toEqual(entry);
	});
});

describe("isFresh", () => {
	test("is false without an entry", () => {
		expect(isFresh(undefined, entry.checkedAt)).toBe(false);
	});

	test("accepts an entry inside the window, including the boundary", () => {
		expect(isFresh(entry, entry.checkedAt)).toBe(true);
		expect(isFresh(entry, entry.checkedAt + 1_000)).toBe(true);
		expect(isFresh(entry, entry.checkedAt + UPDATE_CACHE_TTL_MS)).toBe(true);
	});

	test("rejects an entry past the window, and one from the future", () => {
		expect(isFresh(entry, entry.checkedAt + UPDATE_CACHE_TTL_MS + 1)).toBe(false);
		expect(isFresh(entry, entry.checkedAt - 1)).toBe(false);
	});

	test("honours a caller's window", () => {
		expect(isFresh(entry, entry.checkedAt + 10, 5)).toBe(false);
		expect(isFresh(entry, entry.checkedAt + 10, 10)).toBe(true);
	});
});
