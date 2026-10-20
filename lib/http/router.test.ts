import { describe, expect, test } from "bun:test";
import { isLocalHostHeader, parseRequestUrl } from "./router.ts";

describe("parseRequestUrl", () => {
	test("splits a path target into its path and query", () => {
		const parsed = parseRequestUrl("/browse/sub?mode=staged&q=a%20b");
		expect(parsed?.pathname).toBe("/browse/sub");
		expect(parsed?.search.get("mode")).toBe("staged");
		expect(parsed?.search.get("q")).toBe("a b");
	});

	test("parses the root with an empty query", () => {
		const parsed = parseRequestUrl("/");
		expect(parsed?.pathname).toBe("/");
		expect([...(parsed?.search.keys() ?? [])]).toEqual([]);
	});

	test("accepts an absolute target, keeping only its own path", () => {
		// A proxy-style absolute target must not become an open redirect: the origin
		// in the target is ignored, so the route sees `/view/a.txt`.
		const parsed = parseRequestUrl("http://evil.example/view/a.txt?raw=1");
		expect(parsed?.pathname).toBe("/view/a.txt");
		expect(parsed?.search.get("raw")).toBe("1");
	});

	test("reports a malformed target instead of guessing", () => {
		expect(parseRequestUrl("http://[")).toBeUndefined();
	});
});

describe("isLocalHostHeader", () => {
	test("accepts every loopback spelling", () => {
		for (const host of ["127.0.0.1", "127.0.0.1:49152", "localhost", "localhost:8080", "[::1]", "[::1]:80"]) {
			expect(isLocalHostHeader({ host }, { required: true }), host).toBe(true);
		}
	});

	test("refuses a foreign host either way", () => {
		expect(isLocalHostHeader({ host: "evil.example" }, { required: true })).toBe(false);
		expect(isLocalHostHeader({ host: "evil.example" }, { required: false })).toBe(false);
	});

	test("a missing host is lenient only when not required", () => {
		expect(isLocalHostHeader({}, { required: false })).toBe(true);
		expect(isLocalHostHeader({}, { required: true })).toBe(false);
	});

	test("an empty or non-string host never satisfies a required check", () => {
		expect(isLocalHostHeader({ host: "" }, { required: false })).toBe(true);
		expect(isLocalHostHeader({ host: "" }, { required: true })).toBe(false);
		expect(isLocalHostHeader({ host: ["127.0.0.1"] }, { required: true })).toBe(false);
	});
});
