/**
 * Proving a file may go before it is removed.
 *
 * Every case runs against a real directory, because the property is a property of the filesystem:
 * a rename is one instant, and a link fails exactly when the name is taken. A mock would answer
 * the question this module exists to ask.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { textOf } from "../../test/helpers/scan.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { removeIfProven } from "./proven-remove.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A fresh directory, and a file in it holding `text`. */
function scratch(text = "stale"): { dir: string; path: string } {
	const dir = temps.track(tempDir("pi-proven-"));
	const path = join(dir, "target");
	writeFileSync(path, text);
	return { dir, path };
}

/** What is left beside the target: the moved copies a call did not clean up. */
function debris(dir: string, name: string): string[] {
	return readdirSync(dir).filter((entry) => entry !== name);
}

describe("removeIfProven", () => {
	test("removes the file when the copy it took aside proves", async () => {
		const { dir, path } = scratch();
		expect(await removeIfProven(path, (moved) => Promise.resolve(textOf(moved) === "stale"))).toBe(true);
		expect(existsSync(path)).toBe(false);
		// The moved copy goes with it, so a removal leaves one directory as it found it.
		expect(debris(dir, basename(path))).toEqual([]);
	});

	test("puts it back when the copy does not prove, and leaves no debris", async () => {
		const { dir, path } = scratch();
		expect(await removeIfProven(path, () => Promise.resolve(false))).toBe(false);
		expect(textOf(path)).toBe("stale");
		expect(debris(dir, basename(path))).toEqual([]);
	});

	test("keeps a newer file that took the name, and still removes the one it moved", async () => {
		const { dir, path } = scratch();
		// The name is free between the rename and the restore, so a rival writes there in exactly
		// that window — and its file is newer than the one this call moved.
		const kept = await removeIfProven(path, () => {
			writeFileSync(path, "newer");
			return Promise.resolve(false);
		});
		expect(kept).toBe(false);
		expect(textOf(path)).toBe("newer");
		// The restore could not link over the newer file, so the moved copy is the debris unless it
		// is removed: that is the half of the restore a board's root would keep forever.
		expect(debris(dir, basename(path))).toEqual([]);
	});

	test("answers false for a file that is not there, and creates nothing", async () => {
		const { dir, path } = scratch();
		await Promise.resolve();
		const missing = join(dirname(path), "absent");
		expect(await removeIfProven(missing, () => Promise.resolve(true))).toBe(false);
		expect(debris(dir, basename(path))).toEqual([]);
	});
});
