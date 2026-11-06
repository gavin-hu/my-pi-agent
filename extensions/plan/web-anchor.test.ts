/**
 * The anchor every browser save is held to: the revision its own page rendered.
 *
 * The plan is one file with many readers — two tabs of one review, a phone on a shared
 * link, a model rewriting the plan between them — so "the plan still matches what the page
 * showed" has to be a fact about *that page*, not about the session. One session-wide text
 * meant a second tab's refetch repaired the guard for a stale one, and the comments then
 * landed under text nobody had read.
 *
 * The cases drive the shipped session over a socket, because the anchor lives in the store's
 * per-plan turn and the value it compares comes from the island the server itself renders.
 */

import { describe, expect, test } from "bun:test";
import { feedbackUrl, pagePost, reviewSuite, servedRev } from "../../test/helpers/fixtures/plan-web.ts";
import { testMountSource } from "../../test/helpers/serve.ts";

const { startShared } = reviewSuite();

describe("a save is anchored to its own page", () => {
	test("refuses a page whose plan moved, even after another tab refreshed the session", async () => {
		const { session, content, rewrite } = await startShared({ mount: testMountSource("127.0.0.1") });
		// The tab rendered this revision.
		const stale = await servedRev(session.url);
		rewrite("# Plan\n\nA body the reader never saw.\n");
		// A second tab (or this one, reloading) re-reads the page: the session's own idea of
		// "what was rendered" now matches the file, which is exactly what used to repair the
		// guard for the stale tab.
		await servedRev(session.url);

		const response = await pagePost(
			session,
			"/api/feedback",
			{ annotations: [{ anchor: 1, comment: "stale" }] },
			stale,
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ error: expect.stringContaining("changed on disk") });
		expect(content()).not.toContain("stale");
	});

	test("writes from a page that is still the plan's own revision", async () => {
		const { session, content, rewrite } = await startShared({ mount: testMountSource("127.0.0.1") });
		rewrite("# Plan\n\nA post the plan already carries.\n");
		const current = await servedRev(session.url);

		const response = await pagePost(
			session,
			"/api/feedback",
			{ annotations: [{ anchor: 1, comment: "read this" }] },
			current,
		);

		expect(response.status).toBe(200);
		expect(content()).toContain("> [!REVIEW] read this");
	});

	test("refuses a body that names no revision, and says what to do", async () => {
		const { session, content } = await startShared({ mount: testMountSource("127.0.0.1") });

		const response = await fetch(feedbackUrl(session), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "unanchored" }] }),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: expect.stringContaining("which revision") });
		expect(content()).not.toContain("unanchored");
	});
});
