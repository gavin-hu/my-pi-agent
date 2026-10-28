/**
 * The review's event stream and the plan poll behind it: what an open page is told
 * when a comment, a share, or a rewritten plan lands, and what it is not told.
 */

import { describe, expect, test } from "bun:test";
import { settle } from "../../test/helpers/process.ts";
import { testMountSource } from "../../test/helpers/serve.ts";
import {
	apiOf,
	eventsUrl,
	LAN,
	manualTick,
	nextFrame,
	PATH,
	reviewSuite,
} from "../../test/helpers/fixtures/plan-web.ts";
const { startShared } = reviewSuite();

describe("review stream", () => {
	test("tells an open page when a comment arrives", async () => {
		const { review, session } = await startShared({ mount: testMountSource("127.0.0.1") }, { canApprove: true });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		// The owner's page is open on the loopback stream when the comment lands.
		const stream = await fetch(eventsUrl(session));
		const frame = nextFrame(stream.body);

		await fetch(apiOf(link.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "hello", author: "alice" }] }),
		});

		expect(await frame).toBe("comment");
	});

	test("tells an open page when sharing starts and stops", async () => {
		const { review, session } = await startShared({ mount: testMountSource("127.0.0.1") });
		const first = await fetch(eventsUrl(session));
		const frame = nextFrame(first.body);

		await review.share();
		expect(await frame).toBe("share");
	});
});

describe("plan poll", () => {
	test("reaches an open page when the plan is rewritten on disk", async () => {
		const manual = manualTick();
		const { session, content, rewrite } = await startShared({ networkInterfaces: LAN, tick: manual.tick });
		const stream = await fetch(eventsUrl(session));
		const frame = nextFrame(stream.body);

		rewrite(`${content()}\n- [ ] three\n`);
		manual.fire();

		expect(await frame).toBe("plan");
	});

	test("says nothing when the file changed only in its stored comments", async () => {
		const manual = manualTick();
		const { session, store } = await startShared({ networkInterfaces: LAN, tick: manual.tick });
		const stream = await fetch(eventsUrl(session));
		const frame = nextFrame(stream.body);

		// Another writer's save is a comment, not an edit to the plan text.
		await store.saveFeedback("/repo", PATH, [{ anchor: 1, comment: "a note", author: "alice" }]);
		manual.fire();

		expect(await Promise.race([frame, settle(60).then(() => "silent")])).toBe("silent");
	});

	test("treats a deleted plan as no news rather than a failure", async () => {
		const manual = manualTick();
		const { session, remove } = await startShared({ networkInterfaces: LAN, tick: manual.tick });
		const stream = await fetch(eventsUrl(session));
		const frame = nextFrame(stream.body);

		remove();
		manual.fire();

		expect(await Promise.race([frame, settle(60).then(() => "silent")])).toBe("silent");
	});

	test("stops polling when the review closes", async () => {
		const manual = manualTick();
		const { session } = await startShared({ networkInterfaces: LAN, tick: manual.tick });
		expect(manual.armed()).toBe(true);

		await session.close();

		expect(manual.stopped()).toBe(true);
	});
});
