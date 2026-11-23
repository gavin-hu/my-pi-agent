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

	test("answers a session with no page open before it reads anything", async () => {
		const { handler } = reviewRoute({ scope: undefined });
		expect((await reply(handler, request("GET", "/file?path=a.ts"))).status).toBe(409);
	});
});
