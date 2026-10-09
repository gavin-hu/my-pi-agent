import { describe, expect, test } from "bun:test";
import { isBlockedRenderTarget } from "./render.ts";

describe("isBlockedRenderTarget", () => {
	test("blocks non-http(s) and internal targets", () => {
		for (const url of [
			"file:///etc/passwd",
			"http://localhost:8080/",
			"http://169.254.169.254/",
			"http://10.0.0.1/",
			"http://foo.internal/",
			"http://[::1]/",
		]) {
			expect(isBlockedRenderTarget(url)).toBe(true);
		}
	});

	test("allows public http(s) targets", () => {
		expect(isBlockedRenderTarget("https://example.com/")).toBe(false);
		expect(isBlockedRenderTarget("https://1.1.1.1/")).toBe(false);
	});

	test("treats an unparseable url as blocked", () => {
		expect(isBlockedRenderTarget("not a url")).toBe(true);
	});
});
