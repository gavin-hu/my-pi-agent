import { describe, expect, test } from "bun:test";
import { jsonHeaders, PAGE_CSP, pageHeaders, scriptHeaders } from "./headers.ts";

/** Every header set a loopback server sends, by name. */
const SETS = [
	["page", pageHeaders, "text/html; charset=utf-8"],
	["script", scriptHeaders, "text/javascript; charset=utf-8"],
	["json", jsonHeaders, "application/json; charset=utf-8"],
] as const;

describe("header sets", () => {
	test("share one page policy", () => {
		for (const [name, build] of SETS) {
			expect(build()["Content-Security-Policy"], name).toBe(PAGE_CSP);
		}
	});

	test("carry the framing refusal and the no-store envelope", () => {
		for (const [name, build] of SETS) {
			const headers = build();
			expect(headers["X-Frame-Options"], name).toBe("DENY");
			expect(headers["X-Content-Type-Options"], name).toBe("nosniff");
			expect(headers["Referrer-Policy"], name).toBe("no-referrer");
			expect(headers["Cache-Control"], name).toBe("no-store");
		}
	});

	test("refuse framing, a re-pointed base, and a form submission", () => {
		// The three directives a page needs to be safe to leave open; stated once
		// here so a route cannot quietly serve a weaker policy.
		expect(PAGE_CSP).toContain("frame-ancestors 'none'");
		expect(PAGE_CSP).toContain("base-uri 'self'");
		expect(PAGE_CSP).toContain("form-action 'none'");
		expect(PAGE_CSP).toContain("default-src 'none'");
		expect(PAGE_CSP).toContain("script-src 'self'");
	});

	test("name their own content type", () => {
		for (const [name, build, contentType] of SETS) {
			expect(build()["Content-Type"], name).toBe(contentType);
		}
	});

	test("return a fresh object, so a route can add a header safely", () => {
		const first = pageHeaders();
		first.Allow = "GET, HEAD";
		expect(pageHeaders().Allow).toBeUndefined();
		expect(jsonHeaders().Allow).toBeUndefined();
	});
});
