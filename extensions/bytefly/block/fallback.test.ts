import { describe, expect, test } from "bun:test";
import { fakeTheme } from "../../../test/helpers/fakes.ts";
import { callFallback, resultFallback } from "./fallback.ts";

describe("callFallback", () => {
	test("names the tool and previews its arguments", () => {
		const line = callFallback("read", { path: "a.ts" }, fakeTheme, false);
		expect(line).toContain("read");
		expect(line).toContain('path="a.ts"');
	});

	test("expands arguments onto indented lines and sanitizes them", () => {
		const text = callFallback("x", { a: "b\u0007c" }, fakeTheme, true);
		expect(text).toContain("a: b c");
		expect(text).not.toContain("\u0007");
	});

	test("is just the title without arguments", () => {
		expect(callFallback("x", undefined, fakeTheme, false)).toBe("x");
	});
});

describe("resultFallback", () => {
	test("caps collapsed lines and notes the rest", () => {
		const content = [{ type: "text", text: Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n") }];
		const output = resultFallback(content, fakeTheme, false);
		expect(output.split("\n")).toHaveLength(11);
		expect(output).toContain("10 more lines");
	});

	test("keeps every line when expanded", () => {
		expect(resultFallback([{ type: "text", text: "a\nb" }], fakeTheme, true)).toBe("a\nb");
	});

	test("is empty without text content", () => {
		expect(resultFallback([], fakeTheme, false)).toBe("");
	});
});
