import { describe, expect, test } from "bun:test";
import { WEB_BASE_CSS } from "./base.ts";

describe("web base", () => {
	test("normalises box sizing and hidden", () => {
		expect(WEB_BASE_CSS).toContain("*{box-sizing:border-box}");
		expect(WEB_BASE_CSS).toContain("[hidden]{display:none!important}");
	});

	test("styles links from tokens, never literals", () => {
		expect(WEB_BASE_CSS).toContain("a{color:var(--accent)");
	});

	test("gives every focusable element one ring", () => {
		expect(WEB_BASE_CSS).toContain("outline:var(--focus-ring) solid var(--accent)");
		expect(WEB_BASE_CSS).toContain(":focus-visible");
	});

	test("carries the skip link and screen-reader helper", () => {
		expect(WEB_BASE_CSS).toContain(".skip{");
		expect(WEB_BASE_CSS).toContain(".skip:focus{");
		expect(WEB_BASE_CSS).toContain(".sr-only{");
	});
});
