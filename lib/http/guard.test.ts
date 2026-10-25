/**
 * The request guards: the method allowlist, the `Host` allowlist, the
 * cross-origin refusal, and the JSON body check.
 *
 * `plan`'s review server and `board`'s page both serve a document that can write,
 * so the order these run in and the sentence each refusal carries live here once.
 * The cases pin the order (405, then 403 for the host, then the origin check) and
 * the fact that every state-changing method — not only POST — is origin-checked.
 */

import { describe, expect, test } from "bun:test";
import { checkOrigin, envelopeRefusal, PAGE_METHODS, postOnly, requireJsonBody } from "./guard.ts";
import { LOOPBACK_HOSTS } from "./router.ts";

/** The headers a page's own fetch sends, so a case starts from an allowed request. */
const sameOrigin = { host: "127.0.0.1:4812", origin: "http://127.0.0.1:4812" };

describe("postOnly", () => {
	test("lets POST through", () => {
		expect(postOnly("POST", "approve")).toBeUndefined();
	});

	test("refuses another method with the reason", () => {
		const refusal = postOnly("GET", "approve");
		expect(refusal?.status).toBe(405);
		expect(refusal?.body).toContain("Use POST to approve.");
	});
});

describe("checkOrigin", () => {
	test("accepts the page's own request", () => {
		expect(checkOrigin(sameOrigin)).toBeUndefined();
	});

	test("accepts a request with no origin at all", () => {
		// A script or a test has no ambient credential to abuse.
		expect(checkOrigin({ host: "127.0.0.1:4812" })).toBeUndefined();
	});

	test("refuses a classification another site sets", () => {
		for (const site of ["cross-site", "same-site"]) {
			const refusal = checkOrigin({ ...sameOrigin, "sec-fetch-site": site });
			expect(refusal?.status, site).toBe(403);
			expect(refusal?.body, site).toContain("Cross-origin request refused.");
		}
	});

	test("accepts same-origin and a user-typed navigation", () => {
		for (const site of ["same-origin", "none", ""]) {
			expect(checkOrigin({ ...sameOrigin, "sec-fetch-site": site }), site).toBeUndefined();
		}
	});

	test("refuses an origin naming another host", () => {
		const refusal = checkOrigin({ host: "127.0.0.1:4812", origin: "http://evil.example" });
		expect(refusal?.status).toBe(403);
		expect(refusal?.body).toContain("Cross-origin request refused.");
	});

	test("refuses an origin that is empty or unparseable", () => {
		expect(checkOrigin({ host: "127.0.0.1:4812", origin: "" })?.body).toContain("Unexpected Origin header.");
		expect(checkOrigin({ host: "127.0.0.1:4812", origin: "http://[" })?.body).toContain("Unexpected Origin header.");
	});
});

describe("requireJsonBody", () => {
	test("accepts JSON with its charset", () => {
		expect(requireJsonBody("application/json")).toBeUndefined();
		expect(requireJsonBody("application/json; charset=utf-8")).toBeUndefined();
		expect(requireJsonBody("APPLICATION/JSON")).toBeUndefined();
	});

	test("refuses a form, a plain body, and a missing type", () => {
		for (const value of ["application/x-www-form-urlencoded", "text/plain", "", undefined]) {
			expect(requireJsonBody(value)?.status, String(value)).toBe(415);
		}
	});

	test("reads the first value when a header repeats", () => {
		expect(requireJsonBody(["application/json", "text/plain"])).toBeUndefined();
	});
});

describe("envelopeRefusal", () => {
	const hosts = [...LOOPBACK_HOSTS];

	test("serves the allowed methods", () => {
		for (const method of PAGE_METHODS) {
			expect(envelopeRefusal({ method, headers: sameOrigin, hosts }), method).toBeUndefined();
		}
	});

	test("refuses another method and says which are served", () => {
		const refusal = envelopeRefusal({ method: "PUT", headers: sameOrigin, hosts });
		expect(refusal?.status).toBe(405);
		expect(refusal?.body).toContain("Only GET, HEAD, and POST are served.");
		expect(refusal?.headers.Allow).toBe("GET, HEAD, POST");
	});

	test("a route set that takes DELETE names it", () => {
		const allowed = [...PAGE_METHODS, "DELETE"];
		expect(envelopeRefusal({ method: "DELETE", headers: sameOrigin, hosts, allowed })).toBeUndefined();
		expect(envelopeRefusal({ method: "PUT", headers: sameOrigin, hosts, allowed })?.body).toContain(
			"Only GET, HEAD, POST, and DELETE are served.",
		);
	});

	test("fails closed on a missing or foreign Host", () => {
		const foreign = envelopeRefusal({ method: "GET", headers: { host: "evil.example" }, hosts });
		expect(foreign?.status).toBe(403);
		expect(foreign?.body).toContain("Unexpected Host header.");
		expect(envelopeRefusal({ method: "GET", headers: {}, hosts })?.status).toBe(403);
	});

	test("checks the method before the host, so a probe gets one answer", () => {
		const refusal = envelopeRefusal({ method: "PUT", headers: { host: "evil.example" }, hosts });
		expect(refusal?.status).toBe(405);
	});

	test("origin-checks every state-changing method, not only POST", () => {
		const foreign = { host: "127.0.0.1:4812", origin: "http://evil.example" };
		for (const method of ["POST", "DELETE", "PATCH"]) {
			expect(
				envelopeRefusal({ method, headers: foreign, hosts, allowed: [...PAGE_METHODS, "DELETE", "PATCH"] })?.status,
				method,
			).toBe(403);
		}
	});

	test("a read is never origin-checked", () => {
		// A browser navigation carries an Origin for a cross-site link; that must not
		// stop the page itself from being served.
		const linked = { host: "127.0.0.1:4812", origin: "http://elsewhere.example" };
		expect(envelopeRefusal({ method: "GET", headers: linked, hosts })).toBeUndefined();
	});
});
