/**
 * The spelling rule in `path.ts`, on the shapes that break it.
 *
 * A path arrives with whichever separator built it: `node:path`'s `win32.sep` for git's
 * output on a Windows runner and for a value another machine wrote, `posix.sep` for what
 * this platform builds. The fixtures are built with `node:path`'s own `join` in both
 * families rather than typed, so the Windows shape is exercised on macOS — which is the
 * mistake this suite exists for: a comparison written against one spelling passed here
 * and failed on the Windows job.
 */

import { describe, expect, test } from "bun:test";
import { posix, win32 } from "node:path";
import { encodePath, lastSegment, posixPath } from "./path.ts";

/** `C:\Users\repo\lib\notice.ts`, built by `node:path`'s Windows `join`. */
const WINDOWS_FILE = win32.join("C:", "Users", "repo", "lib", "notice.ts");

/** The same path in the POSIX spelling this package prints, built the same way. */
const POSIX_FILE = posix.join("C:", "Users", "repo", "lib", "notice.ts");

/** A path carrying both separators, the shape a page or a git read can hand over. */
const MIXED = `${win32.join("C:", "a")}${posix.sep}b${posix.sep}c.ts`;

/** A UNC root, `\\server\share\dir\file.ts`, with no separator typed by hand. */
const UNC_FILE = win32.join(win32.sep + win32.sep + "server", "share", "dir", "file.ts");

/** A leading UNC pair, spelled for a URL. */
const UNC_POSIX = posix.sep + posix.sep + ["server", "share", "dir", "file.ts"].join(posix.sep);

describe("posixPath", () => {
	test("spells a Windows path the way this package prints one", () => {
		expect(posixPath(WINDOWS_FILE)).toBe(POSIX_FILE);
	});

	test("spells a path that already carries both separators once", () => {
		expect(posixPath(MIXED)).toBe(posix.join("C:", "a", "b", "c.ts"));
	});

	test("leaves a path with no separator alone", () => {
		expect(posixPath("notice.ts")).toBe("notice.ts");
	});

	test("normalises a UNC root without losing its leading pair", () => {
		expect(posixPath(UNC_FILE)).toBe(UNC_POSIX);
	});

	test("is idempotent, so a caller may normalise twice", () => {
		expect(posixPath(posixPath(WINDOWS_FILE))).toBe(POSIX_FILE);
	});
});

describe("lastSegment", () => {
	test("names the file a Windows path ends in", () => {
		expect(lastSegment(WINDOWS_FILE)).toBe("notice.ts");
	});

	test("ignores a trailing separator", () => {
		expect(lastSegment(win32.join("C:", "repo") + win32.sep)).toBe("repo");
	});

	test("answers nothing for a root or an empty string", () => {
		expect(lastSegment(posix.sep)).toBe("");
		expect(lastSegment("")).toBe("");
	});
});

describe("encodePath", () => {
	test("encodes each segment of a Windows path and keeps the separators", () => {
		expect(encodePath(win32.join("sub", "a b#c.ts"))).toBe(posix.join("sub", "a%20b%23c.ts"));
	});

	test("encodes a root-relative POSIX path segment by segment", () => {
		expect(encodePath(posix.join("a", "b c", "d&e.txt"))).toBe(posix.join("a", "b%20c", "d%26e.txt"));
	});
});
