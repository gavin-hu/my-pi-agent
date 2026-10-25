/**
 * The shared label rules: the cap, the one-line flattening, and the fallback
 * chain a session betrays its name with.
 *
 * These live in `lib/` because the board records a label on a card and
 * `session-bus` settles the one a session is addressed by, so the two must agree
 * character for character — a card that names `billing core` while the bus
 * answers to `billing-core` cannot be assigned.
 */

import { describe, expect, test } from "bun:test";
import { defaultLabel, MAX_LABEL, normalizeLabel, shortId } from "./session-label.ts";

describe("normalizeLabel", () => {
	test("collapses whitespace and trims", () => {
		expect(normalizeLabel("  billing   core \n", "fallback")).toBe("billing core");
	});

	test("falls back when the name is empty or missing", () => {
		expect(normalizeLabel(undefined, "fallback")).toBe("fallback");
		expect(normalizeLabel("   ", "fallback")).toBe("fallback");
	});

	test("keeps one line, so a label cannot wrap a row or open a second line", () => {
		expect(normalizeLabel("a\r\nb", "fallback")).toBe("a b");
	});

	test("caps the label, and the cap is what a target may be", () => {
		const long = "x".repeat(MAX_LABEL + 20);
		expect(normalizeLabel(long, "fallback")).toHaveLength(MAX_LABEL);
	});
});

describe("shortId", () => {
	test("keeps the tail of the alphanumerics", () => {
		expect(shortId("2026-10-25-abc123")).toBe("abc123");
	});

	test("survives an id with nothing alphanumeric in it", () => {
		expect(shortId("----")).toBe("----");
	});
});

describe("defaultLabel", () => {
	test("prefers the Pi session name", () => {
		expect(defaultLabel("billing lead", "/repo/somewhere", "id-1")).toBe("billing lead");
	});

	test("falls back to the working directory's basename", () => {
		expect(defaultLabel(undefined, "/repo/my-pi-agent", "id-1")).toBe("my-pi-agent");
		expect(defaultLabel("   ", "/repo/my-pi-agent", "id-1")).toBe("my-pi-agent");
	});

	test("falls back to `session` when there is no name and no directory to borrow", () => {
		// A cwd with no last segment borrows nothing, and the label itself is the
		// fallback before the id ever is.
		expect(defaultLabel(undefined, "/", "session-9191")).toBe("session");
	});

	test("a windows path borrows its last segment too", () => {
		expect(defaultLabel(undefined, "C:\\work\\billing", "id-1")).toBe("billing");
	});
});
