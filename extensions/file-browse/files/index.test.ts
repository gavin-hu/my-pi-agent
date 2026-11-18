/**
 * What the quick-open walk refused, and what it says about it.
 *
 * `files.test.ts` is at its size bar, so the report the palette words its empty state from lives
 * here rather than growing that suite by a case. The walk's rule and this report are one
 * decision — `INDEX_IGNORED_DIRS` — so the cases read `buildFileIndex` directly and name the
 * distinction the message depends on: a directory it refused at the root is named, one it
 * refused deeper is not.
 *
 * Each case builds and drops its own fixture: the shared tree `files.test.ts` uses is made by a
 * helper there, and a second copy of that helper is what the shared-helper guard refuses.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeFixture } from "../../../test/helpers/fixtures/file-browse.ts";
import { buildFileIndex } from "./index.ts";

describe("the quick-open index's refused folders", () => {
	test("names the root's own directories it refused, and only those", async () => {
		const fixture = makeFixture();
		try {
			mkdirSync(join(fixture.root, ".git"), { recursive: true });
			mkdirSync(join(fixture.root, "node_modules", "pkg"), { recursive: true });
			mkdirSync(join(fixture.root, "sub", "node_modules"), { recursive: true });
			const index = await buildFileIndex(fixture.root, 1000);
			// The walk refuses both names at any depth, but only a root-level one is named: the
			// message built from this list is about the folders beside the reader's own files.
			expect(index.skipped).toEqual([".git", "node_modules"]);
			// And the refusal still costs the paths, which is what the palette has to own up to.
			expect(index.files.some((path) => path.startsWith("node_modules/"))).toBe(false);
		} finally {
			fixture.remove();
		}
	});

	test("names nothing when the root has no refused directory", async () => {
		const fixture = makeFixture();
		try {
			expect((await buildFileIndex(fixture.root, 1000)).skipped).toEqual([]);
		} finally {
			fixture.remove();
		}
	});
});
