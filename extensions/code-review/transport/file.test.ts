/**
 * The whole-file route: a path the review lists, read under the root it reviews.
 *
 * The route decides three things a view cannot — whether the file is in this review at all,
 * whether its bytes stay inside the checkout, and what a binary or a cut file answers — so
 * the cases here drive the handler, over a stub reader whose text is a fixture.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import { request, reply, reviewRoute } from "../../../test/helpers/review-route.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A stage whose snapshot lists `a.ts` and a `link.ts` that will point outside the root. */
function stage(root: string) {
	const file = (rel: string) => ({ rel, status: "A", add: 1, del: 0, binary: false, truncated: false, lines: [] });
	return reviewRoute({ place: { root, repo: "repo" }, files: [file("a.ts"), file("link.ts")] });
}

describe("the whole-file route", () => {
	const root = temps.track(mkdtempSync(join(tmpdir(), "pi-review-file-")));

	test("serves a listed file's whole text, with the diff's own gutter", async () => {
		const { handler } = stage(root);
		const response = await reply(handler, request("GET", "/file?scope=base&path=a.ts"));
		expect(response.status).toBe(200);
		expect(String(response.body)).toContain('data-path="a.ts"');
		expect(String(response.body)).toContain("browse-diff-no");
	});

	test("refuses a path the review does not list, and a request that names none", async () => {
		const { handler } = stage(root);
		expect((await reply(handler, request("GET", "/file?path=other.ts"))).status).toBe(404);
		expect((await reply(handler, request("GET", "/file"))).status).toBe(404);
	});

	test("refuses a listed path that resolves outside the root", async () => {
		const outside = temps.track(mkdtempSync(join(tmpdir(), "pi-review-outside-")));
		writeFileSync(join(outside, "secret.ts"), "secret\n");
		symlinkSync(join(outside, "secret.ts"), join(root, "link.ts"));
		const { handler } = stage(root);
		expect((await reply(handler, request("GET", "/file?path=link.ts"))).status).toBe(403);
	});

	test("draws the page's comparison whatever the address asked with", async () => {
		const { handler } = stage(root);
		const response = await reply(handler, request("GET", "/file?scope=staged&path=a.ts"));
		expect(response.status).toBe(200);
		// The way back names the comparison the page is on, not the one a stale link carried.
		expect(String(response.body)).toContain('href="/review/new?scope=branch"');
	});

	test("serves the file view's own script, and loads it from the page", async () => {
		const { handler } = stage(root);
		const script = await reply(handler, request("GET", "/file.js"));
		expect(script.status).toBe(200);
		expect(String(script.body)).toContain("rv-wrap");

		const page = await reply(handler, request("GET", "/file?path=a.ts"));
		expect(String(page.body)).toContain('src="/review/file.js"');
		// The page serves no key sheet, so it draws no trigger for one.
		expect(String(page.body)).not.toContain('id="keys-open"');
	});

	test("names the repository it read and the comparison the page is on", async () => {
		const { handler } = stage(root);
		const response = await reply(handler, request("GET", "/file?path=a.ts"));
		// The header's facts carry the repo, the footer the comparison — the diff page's split.
		expect(String(response.body)).toContain('<div class="bf-app__facts">repo</div>');
		expect(String(response.body)).toContain('<span class="bf-footer__facts">main...HEAD</span>');
	});

	test("answers a session with no page open before it reads anything", async () => {
		const { handler } = reviewRoute({ scope: undefined });
		expect((await reply(handler, request("GET", "/file?path=a.ts"))).status).toBe(409);
	});
});
