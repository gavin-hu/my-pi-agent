import { describe, expect, test } from "bun:test";
import { isInside } from "./path.ts";

describe("isInside", () => {
	test("accepts the root and descendants", () => {
		expect(isInside("/a/b", "/a/b")).toBe(true);
		expect(isInside("/a/b", "/a/b/c")).toBe(true);
		expect(isInside("/a/b", "/a/b/c/d")).toBe(true);
	});

	test("rejects siblings, parents, and prefixes", () => {
		expect(isInside("/a/b", "/a/c")).toBe(false);
		expect(isInside("/a/b", "/a")).toBe(false);
		expect(isInside("/a/b", "/a/bc")).toBe(false);
	});
});
