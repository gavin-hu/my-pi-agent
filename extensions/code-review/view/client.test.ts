/**
 * The page's bundle: it parses as one script, writes only to the page's own
 * routes, and never turns a comment into markup.
 *
 * A served page is a template literal no type checker reads, so the checks here
 * are text: the routes it names are the router's, every write carries the page's
 * token and snapshot, and no body is injected as HTML.
 */

import { describe, expect, test } from "bun:test";
import { REVIEW_CLIENT_JS } from "./client.ts";

/** The URLs the bundle posts to, without the mount prefix. */
function postPaths(source: string): string[] {
	return [...new Set([...source.matchAll(/"(\/api\/[a-z]+)"/g)].map((match) => match[1]))].sort();
}

describe("the review bundle", () => {
	test("parses as one script, with the prefix reader it calls defined", () => {
		expect(() => new Function(REVIEW_CLIENT_JS)).not.toThrow();
		expect(REVIEW_CLIENT_JS).toContain("function pageBase(");
	});

	test("writes only to the four routes the page serves", () => {
		expect(postPaths(REVIEW_CLIENT_JS)).toEqual(["/api/comment", "/api/drop", "/api/reviewed", "/api/send"]);
	});

	test("every write carries the page's token and the snapshot it rendered", () => {
		expect(REVIEW_CLIENT_JS).toContain("payload.token = token;");
		expect(REVIEW_CLIENT_JS).toContain("payload.rev = rev;");
		expect(REVIEW_CLIENT_JS).toContain("postJson(base + path, payload)");
	});

	test("reads its mount prefix from the page, not from the origin's root", () => {
		expect(REVIEW_CLIENT_JS).toContain("var base = pageBase();");
	});

	test("never writes a comment as markup", () => {
		expect(REVIEW_CLIENT_JS).not.toContain("innerHTML");
		expect(REVIEW_CLIENT_JS).not.toContain("insertAdjacentHTML");
		expect(REVIEW_CLIENT_JS).not.toContain("document.write");
	});

	test("keeps an unsent composer against the snapshot it was typed on", () => {
		expect(REVIEW_CLIENT_JS).toContain('var DRAFT_KEY = "rv-review-draft";');
		expect(REVIEW_CLIENT_JS).toContain("kept.rev === rev");
	});

	test("turns the first write's id into the page's address", () => {
		expect(REVIEW_CLIENT_JS).toContain("window.history.replaceState");
		expect(REVIEW_CLIENT_JS).toContain('url.searchParams.set("token", token);');
	});
});
