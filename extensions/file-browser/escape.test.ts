import { describe, expect, test } from "bun:test";
import { escapeHtml } from "./escape.ts";

describe("escapeHtml", () => {
	test("escapes every HTML-significant character", () => {
		expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
	});

	test("leaves ordinary text untouched", () => {
		expect(escapeHtml("plain text 123")).toBe("plain text 123");
		expect(escapeHtml("")).toBe("");
	});
});
