/**
 * Claim paths, resolved the one way approval and the bus both store them.
 *
 * The paths that must be real are temp directories, compared through
 * `realpathSync.native` because that is the spelling the resolver returns: the
 * non-native call keeps Windows' 8.3 short name, which never compares equal.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";
import { claimPathMessage, resolveClaimPaths } from "./resolve.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A repository root with `src/` already in it, resolved as the OS spells it. */
function repo(): string {
	const root = temps.track(tempDir("pi-claim-paths-"));
	mkdirSync(join(root, "src"));
	return realpathSync.native(root);
}

describe("resolveClaimPaths", () => {
	test("canonicalises a spelling and collapses duplicates, in input order", () => {
		const root = repo();
		expect(resolveClaimPaths(root, ["./src/core/", "src//core", "src/limit"])).toEqual({
			paths: ["src/core", "src/limit"],
		});
	});

	test("accepts a directory the work has not created yet", () => {
		const root = repo();
		expect(resolveClaimPaths(root, ["src/limit/core"])).toEqual({ paths: ["src/limit/core"] });
	});

	test("refuses a path that leaves the repository", () => {
		const root = repo();
		const escaped = resolveClaimPaths(root, ["../elsewhere"]);
		expect(escaped).toMatchObject({ error: { path: "../elsewhere" } });
		if ("error" in escaped)
			expect(claimPathMessage(escaped.error)).toBe('path "../elsewhere" does not resolve to a file in the repository.');
	});

	test("refuses an absolute path rather than re-rooting it under the repository", () => {
		expect(resolveClaimPaths(repo(), ["/etc"])).toMatchObject({
			error: { path: "/etc", reason: "is absolute; a claim is relative to the repository root" },
		});
	});

	test("refuses the root itself, which would own the repository", () => {
		const root = repo();
		expect(resolveClaimPaths(root, ["."])).toMatchObject({
			error: { path: ".", reason: "is the repository, not a path in it" },
		});
		expect(resolveClaimPaths(root, [""])).toMatchObject({ error: { path: "" } });
	});

	test("refuses the first bad path of a list, before writing anything", () => {
		const root = repo();
		expect(resolveClaimPaths(root, ["src/core", "../x", "../y"])).toMatchObject({ error: { path: "../x" } });
	});

	test.skipIf(!canCreateSymlinks())("resolves a symlinked spelling to the directory it names", () => {
		const root = repo();
		mkdirSync(join(root, "real", "target"), { recursive: true });
		symlinkSync(join(root, "real", "target"), join(root, "link"), "dir");
		expect(resolveClaimPaths(root, ["link"])).toEqual({ paths: ["real/target"] });
	});

	test.skipIf(!canCreateSymlinks())("refuses a link that leaves the repository", () => {
		const root = repo();
		const outside = temps.track(tempDir("pi-claim-outside-"));
		symlinkSync(outside, join(root, "out"), "dir");
		expect(resolveClaimPaths(root, ["out"])).toMatchObject({ error: { path: "out" } });
	});

	test("names the file it kept when the root is reached through a link too", () => {
		const root = repo();
		const link = temps.track(join(dirname(root), `${basename(root)}-link`));
		if (!canCreateSymlinks()) return;
		symlinkSync(root, link, "dir");
		expect(resolveClaimPaths(link, ["src/core"])).toEqual({ paths: ["src/core"] });
	});
});
