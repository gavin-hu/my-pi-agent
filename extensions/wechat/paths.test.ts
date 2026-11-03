/**
 * A value from the wire becomes one filesystem name.
 *
 * A media file's name and a peer's session directory both come from what the
 * server sent, so both go through `sanitizePathSegment`: a separator, a leading
 * dot, or `..` must not name another peer's history or climb out of the root it
 * belongs to.
 */

import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { isInside } from "../../lib/path.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { peerSessionDir } from "./peer/peer-session.ts";
import { sanitizePathSegment } from "./transport/media.ts";

describe("sanitizePathSegment", () => {
	test("keeps one segment and takes the caller's fallback", () => {
		expect(sanitizePathSegment("../../etc/passwd", "unknown")).toBe("_.._etc_passwd");
		expect(sanitizePathSegment("..\\..\\win", "unknown")).toBe("_.._win");
		expect(sanitizePathSegment("   ", "unknown")).toBe("unknown");
		expect(sanitizePathSegment("a".repeat(200), "unknown").length).toBe(120);
	});
});

describe("peer session directories", () => {
	test("keep a hostile peer id to one directory inside the sessions root", () => {
		const root = tempDir("wechat-sessions-");
		for (const hostile of ["../../../etc/passwd", "..", "a/../../b", "..\\..\\win", ".hidden"]) {
			const dir = peerSessionDir(root, hostile);
			expect(isInside(root, dir)).toBe(true);
			expect(dirname(dir)).toBe(root);
		}
		expect(peerSessionDir(root, "..")).toBe(join(root, "unknown"));
	});

	test("keep a legitimate peer's directory, so its history resumes", () => {
		const root = tempDir("wechat-sessions-");
		expect(peerSessionDir(root, "Sam@im.wechat")).toBe(join(root, "sam"));
	});
});
