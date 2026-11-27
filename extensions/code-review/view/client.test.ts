/**
 * The page's bundle: it parses as one script, writes only to the page's own
 * routes, and never turns a comment into markup.
 *
 * A served page is a template literal no type checker reads, so the checks here
 * are text: the routes it names are the router's, every write carries the page's
 * token and snapshot, and no body is injected as HTML.
 */

import { describe, expect, test } from "bun:test";
import { duplicateDeclarations, duplicateFunctions, unfilledPlaceholders } from "../../../test/helpers/bundle.ts";
import { REVIEW_CLIENT_JS } from "./client.ts";
import { REVIEW_COMMENTS_JS } from "./client-comments.ts";
import { REVIEW_DRAFTS_JS } from "./client-drafts.ts";
import { REVIEW_KEYS_JS } from "./client-keys.ts";
import { REVIEW_LIVE_JS } from "./client-live.ts";
import { REVIEW_PLACE_JS } from "./client-place.ts";
import { REVIEW_REVEAL_JS } from "./client-reveal.ts";

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

	test("keeps an unsent composer by the id it carries, across the snapshot it was typed on", () => {
		expect(REVIEW_CLIENT_JS).toContain('var DRAFT_KEY = "rv-review-drafts";');
		// One record per draft, and the record's rev is provenance rather than the write's gate:
		// the composer says where it came from, and every write still carries the page's rev. The id is
		// what a save deletes, so the composer wears it and a relocated record moves with its anchor.
		expect(REVIEW_CLIENT_JS).toContain("function newDraftId(all)");
		expect(REVIEW_CLIENT_JS).toContain('wrap.setAttribute("data-draft-id"');
		expect(REVIEW_CLIENT_JS).not.toContain("function draftKey(");
		expect(REVIEW_CLIENT_JS).toContain("moved: kept.rev !== rev");
		expect(REVIEW_CLIENT_JS).toContain("typed on the earlier diff");
	});

	test("a stale write reveals the reload chip", () => {
		expect(REVIEW_CLIENT_JS).toContain("answer.status === 409");
		expect(REVIEW_CLIENT_JS).toContain("hint.hidden = false");
		expect(REVIEW_CLIENT_JS).toContain("window.location.reload()");
	});

	test("follows the page's stream, and reveals the same reload when a frame says the tree moved", () => {
		expect(REVIEW_CLIENT_JS).toContain("liveStream({");
		expect(REVIEW_CLIENT_JS).toContain('url: base + "/events"');
		// A moved tree arrives as a frame now, not only as a refusal in the tab that wrote.
		expect(REVIEW_CLIENT_JS).toContain("if (frame.moved)");
		expect(REVIEW_CLIENT_JS).toContain('var hint = byId("reload-hint");');
	});

	/**
	 * The clause with a consequence: a frame that lands under an open composer is held, and the
	 * box closing is what releases it. A drop that nothing flushed would be indistinguishable from
	 * a tab that stopped updating, which is why both halves are asserted here rather than one.
	 *
	 * This is the cheap half of the proof and it is a guard, not evidence: it says the bundle
	 * carries both calls, and it was green while the page drew nothing, because a call being
	 * present is not a call drawing anything. `view/live.test.ts` is the half that reads the page.
	 */
	test("holds a frame an open composer would lose, and lands it when the box closes", () => {
		expect(REVIEW_CLIENT_JS).toContain("if (liveTyping()) { livePending = frame.review; return; }");
		expect(REVIEW_CLIENT_JS).toMatch(/function closeComposer\(wrap\) \{[\s\S]*liveFlush\(\);[\s\S]*\}/);
		expect(REVIEW_CLIENT_JS).toContain("function liveFlush()");
	});

	test("turns the first write's id into the page's address", () => {
		expect(REVIEW_CLIENT_JS).toContain("window.history.replaceState");
		expect(REVIEW_CLIENT_JS).toContain('url.searchParams.set("token", token);');
	});

	/**
	 * The split's own hazard: six fragments concatenated into one closure, which no compiler
	 * reads. A fragment left out is a `ReferenceError` on the first paint, and two fragments
	 * declaring one name is which body a caller reaches decided by concatenation order.
	 */
	test("assembles all six fragments, each name once", () => {
		expect(REVIEW_CLIENT_JS).toContain(REVIEW_DRAFTS_JS);
		expect(REVIEW_CLIENT_JS).toContain(REVIEW_COMMENTS_JS);
		expect(REVIEW_CLIENT_JS).toContain(REVIEW_REVEAL_JS);
		expect(REVIEW_CLIENT_JS).toContain(REVIEW_PLACE_JS);
		expect(REVIEW_CLIENT_JS).toContain(REVIEW_KEYS_JS);
		expect(REVIEW_CLIENT_JS).toContain(REVIEW_LIVE_JS);
		expect(duplicateFunctions(REVIEW_CLIENT_JS)).toEqual([]);
		expect(duplicateDeclarations(REVIEW_CLIENT_JS)).toEqual([]);
		expect(unfilledPlaceholders(REVIEW_CLIENT_JS)).toEqual([]);
	});
});
