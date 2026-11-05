/**
 * A value from the wire becomes one filesystem name.
 *
 * A media file's name comes from what the server sent, so it goes through
 * `sanitizePathSegment`: a separator, a leading dot, or `..` must not climb out of
 * the media root it belongs to.
 */

import { describe, expect, test } from "bun:test";
import { sanitizePathSegment } from "./transport/media.ts";

describe("sanitizePathSegment", () => {
	test("keeps one segment and takes the caller's fallback", () => {
		expect(sanitizePathSegment("../../etc/passwd", "unknown")).toBe("_.._etc_passwd");
		expect(sanitizePathSegment("..\\..\\win", "unknown")).toBe("_.._win");
		expect(sanitizePathSegment("   ", "unknown")).toBe("unknown");
		expect(sanitizePathSegment("a".repeat(200), "unknown").length).toBe(120);
	});
});
