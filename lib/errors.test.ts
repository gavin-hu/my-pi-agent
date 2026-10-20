import { describe, expect, test } from "bun:test";
import { messageOf } from "./errors.ts";

describe("messageOf", () => {
	test("returns an Error's message", () => {
		expect(messageOf(new Error("boom"))).toBe("boom");
	});

	test("stringifies anything else", () => {
		expect(messageOf("plain")).toBe("plain");
		expect(messageOf(7)).toBe("7");
		expect(messageOf(undefined)).toBe("undefined");
	});
});
