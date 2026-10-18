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
	updateCachePath,
	writeUpdateCache,
	type UpdateCacheEntry,
} from "./cache.ts";

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

const entry: UpdateCacheEntry = { latest: "0.13.0", checkedAt: 1_767_225_600_000 };

describe("updateCachePath", () => {
	test("sits under the agent directory's bytefly folder", () => {
		expect(updateCachePath("/agent")).toBe(join("/agent", "bytefly", UPDATE_CACHE_FILE));
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

	test("rejects a version that does not parse", () => {
		expect(readUpdateCache(tempFile(JSON.stringify({ latest: "newest", checkedAt: 1 })))).toBeUndefined();
	});

	test("rejects a missing or non-numeric timestamp", () => {
		for (const payload of [{ latest: "0.13.0" }, { latest: "0.13.0", checkedAt: "yesterday" }, []]) {
			expect(readUpdateCache(tempFile(JSON.stringify(payload)))).toBeUndefined();
		}
	});

	test("accepts an entry whose version is older or equal", () => {
		const path = tempFile(JSON.stringify({ latest: "0.0.1", checkedAt: 5 }));
		expect(readUpdateCache(path)).toEqual({ latest: "0.0.1", checkedAt: 5 });
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
