import { describe, expect, test } from "bun:test";
import { PAGE_CSP } from "./headers.ts";
import { htmlResponse, jsonError, jsonResponse, textResponse } from "./response.ts";

describe("response builders", () => {
	test("an HTML response carries the page policy", () => {
		const response = htmlResponse(200, "<p>hi</p>");
		expect(response.status).toBe(200);
		expect(response.body).toBe("<p>hi</p>");
		expect(response.headers["Content-Type"]).toContain("text/html");
		expect(response.headers["Content-Security-Policy"]).toBe(PAGE_CSP);
	});

	test("an HTML response merges the headers a route adds", () => {
		// The 405 page states its `Allow` this way; the merge must not drop the policy.
		const response = htmlResponse(405, "no", { Allow: "GET, HEAD" });
		expect(response.headers.Allow).toBe("GET, HEAD");
		expect(response.headers["Content-Security-Policy"]).toBe(PAGE_CSP);
	});

	test("a JSON response serializes once, with the JSON type", () => {
		const response = jsonResponse(200, { ok: true, items: [1, 2] });
		expect(response.body).toBe('{"ok":true,"items":[1,2]}');
		expect(response.headers["Content-Type"]).toContain("application/json");
	});

	test("the error envelope is `{ error }`", () => {
		const response = jsonError(404, "That page does not exist.");
		expect(response.status).toBe(404);
		expect(JSON.parse(String(response.body))).toEqual({ error: "That page does not exist." });
	});

	test("a text response keeps the envelope and changes only the type", () => {
		const response = textResponse(500, "Internal error");
		expect(response.body).toBe("Internal error");
		expect(response.headers["Content-Type"]).toContain("text/plain");
		expect(response.headers["X-Content-Type-Options"]).toBe("nosniff");
	});
});
