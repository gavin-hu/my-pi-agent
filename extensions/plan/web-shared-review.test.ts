/**
 * Sharing a review over the LAN: the links it mints, the names they bind, the
 * routes a reviewer may call, and the ones only the owner can.
 */

import { describe, expect, test } from "bun:test";
import { settle } from "../../test/helpers/process.ts";
import { testMountSource } from "../../test/helpers/serve.ts";
import {
	apiOf,
	eventsUrl,
	feedbackUrl,
	islandOf,
	LAN,
	nextFrame,
	ownerShares,
	reviewerPost,
	reviewSuite,
} from "../../test/helpers/fixtures/plan-web.ts";
import { MAX_SHARE_LINKS, type ShareState } from "./web-share.ts";
const { startShared } = reviewSuite();

describe("shared review", () => {
	test("reports why it cannot share when no listener answers for it", async () => {
		// `serve` decides whether there is an address to bind; a review whose mount cannot
		// offer one says so instead of inventing a link.
		const { review } = await startShared({
			mount: async (spec) => {
				const mounted = await testMountSource()(spec);
				if (mounted.kind !== "mounted") return mounted;
				return { kind: "mounted", mount: { ...mounted.mount, share: async () => undefined } };
			},
		});
		const result = await review.share();

		expect(result?.state.sharing).toBe(false);
		expect(result?.state.links).toEqual([]);
		expect(result?.state.reason).toContain("no network address");
		expect(result?.svg).toBeUndefined();
	});

	test("mints a reviewer link with a QR and keeps the owner's page working", async () => {
		const { review, session } = await startShared({ mount: testMountSource("127.0.0.1") }, { canApprove: true });
		const result = await review.share();

		expect(result?.state.sharing).toBe(true);
		const link = result?.state.links[0];
		expect(link?.address).toBe("127.0.0.1");
		expect(link?.url).toContain("token=");
		expect(result?.svg).toContain("<svg");
		// The owner's own link still answers: sharing adds a listener, never moves one.
		expect((await fetch(session.url)).status).toBe(200);
		expect(review.shareState()?.sharing).toBe(true);
	});

	test("a reviewer comments under their own name and the owner sees it", async () => {
		const { review, session, content } = await startShared(
			{ mount: testMountSource("127.0.0.1") },
			{ canApprove: true },
		);
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const response = await fetch(apiOf(link.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "name the ceiling", author: "alice" }] }),
		});

		expect(response.status).toBe(200);
		expect(content()).toContain("> [!REVIEW] @alice: name the ceiling");
		const island = islandOf(await (await fetch(session.url)).text());
		expect(island.annotations).toEqual([{ anchor: 1, comment: "name the ceiling", author: "alice" }]);
	});

	test("a reviewer's post keeps the review open and tells the owner's page", async () => {
		const { review, session, content } = await startShared(
			{ mount: testMountSource("127.0.0.1") },
			{ canApprove: true },
		);
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		// The owner's page is reading the loopback stream before the post lands.
		const stream = await fetch(eventsUrl(session));
		const frame = nextFrame(stream.body);

		const response = await fetch(apiOf(link.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "name the ceiling", author: "alice" }] }),
		});

		expect(response.status).toBe(200);
		expect(content()).toContain("@alice: name the ceiling");
		expect(await frame).toBe("comment");
		// A post is not a decision: the review is still waiting for its owner.
		const outcome = await Promise.race([session.done.then(() => "settled"), settle(50).then(() => "pending")]);
		expect(outcome).toBe("pending");
		expect((await fetch(session.url)).status).toBe(200);
	});

	test("a reviewer's second post replaces her comment and nobody else's", async () => {
		const seeded = "# Plan\n- [ ] one\n> [!REVIEW] mine\n> [!REVIEW] @bob: theirs\n- [ ] two\n";
		const { review, content } = await startShared(
			{ mount: testMountSource("127.0.0.1") },
			{ canApprove: true },
			seeded,
		);
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");
		const post = (comment: string) =>
			fetch(apiOf(link.url, "/api/comment"), {
				method: "POST",
				headers: { "content-type": "application/json", origin: new URL(link.url).origin },
				body: JSON.stringify({ annotations: [{ anchor: 1, comment, author: "priya" }] }),
			});

		expect((await post("first note")).status).toBe(200);
		expect((await post("second note")).status).toBe(200);

		const text = content();
		expect(text).toContain("> [!REVIEW] @priya: second note");
		expect(text).not.toContain("first note");
		expect(text).toContain("> [!REVIEW] mine");
		expect(text).toContain("> [!REVIEW] @bob: theirs");
	});

	test("a reviewer must choose a name, and can never save, approve, or cancel", async () => {
		const { review } = await startShared({ mount: testMountSource("127.0.0.1") }, { canApprove: true });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");
		const origin = new URL(link.url).origin;
		const post = (route: string, body = "{}") =>
			fetch(apiOf(link.url, route), {
				method: "POST",
				headers: { "content-type": "application/json", origin },
				body,
			});

		const anonymous = await post("/api/comment", JSON.stringify({ annotations: [{ anchor: 1, comment: "hi" }] }));
		expect(anonymous.status).toBe(400);
		// An empty post claims nothing either, so it cannot bind a name by accident.
		expect((await post("/api/comment", JSON.stringify({ annotations: [] }))).status).toBe(400);
		expect((await post("/api/feedback")).status).toBe(403);
		expect((await post("/api/approve")).status).toBe(403);
		expect((await post("/api/cancel")).status).toBe(403);
		expect((await post("/api/share")).status).toBe(403);
	});

	test("stop sharing revokes the reviewer token and closes the shared listener", async () => {
		const { review } = await startShared({ mount: testMountSource("127.0.0.1") }, { canApprove: true });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const stopped = await review.stopSharing();
		expect(stopped?.state.sharing).toBe(false);

		const refused = await fetch(apiOf(link.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "late", author: "alice" }] }),
		}).then(
			(response) => `answered ${response.status}`,
			() => "refused",
		);
		expect(refused).toBe("refused");
	});

	test("a reviewer's post tells the owner's terminal, and the owner's own save does not", async () => {
		const told: Array<[string, number]> = [];
		const { review, session } = await startShared(
			{ networkInterfaces: LAN },
			{ canApprove: true, onReviewerComment: (author, count) => told.push([author, count]) },
		);
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const posted = await fetch(apiOf(link.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			body: JSON.stringify({
				annotations: [
					{ anchor: 1, comment: "one", author: "alice" },
					{ anchor: 2, comment: "two", author: "alice" },
				],
			}),
		});
		expect(posted.status).toBe(200);
		expect(told).toEqual([["alice", 2]]);

		await fetch(feedbackUrl(session), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(session.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "owner's" }] }),
		});
		expect(told).toEqual([["alice", 2]]);
	});

	test("a reviewer re-posting the page's comments does not duplicate them", async () => {
		const seeded = "# Plan\n- [ ] one\n> [!REVIEW] mine\n> [!REVIEW] @bob: theirs\n- [ ] two";
		const { review, content } = await startShared(
			{ mount: testMountSource("127.0.0.1") },
			{ canApprove: true },
			seeded,
		);
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const page = islandOf(await (await fetch(link.url)).text());
		const response = await fetch(apiOf(link.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(link.url).origin },
			// What a reviewer's page posts: her own comments, including the new one.
			body: JSON.stringify({
				annotations: [
					...page.annotations.filter((annotation) => annotation.author === "priya"),
					{ anchor: 1, comment: "mine too", author: "priya" },
				],
			}),
		});

		expect(response.status).toBe(200);
		const text = content();
		expect(text.match(/> \[!REVIEW\] mine/g)?.length).toBe(1);
		expect(text.match(/@bob: theirs/g)?.length).toBe(1);
		expect(text).toContain("> [!REVIEW] @bob: theirs");
		expect(text).toContain("> [!REVIEW] @priya: mine too");
	});

	test("a link posts under its own bound name, and the page learns it", async () => {
		const { review } = await startShared({ mount: testMountSource("127.0.0.1") }, { canApprove: true });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");
		const comment = (author: string, text: string) =>
			fetch(apiOf(link.url, "/api/comment"), {
				method: "POST",
				headers: { "content-type": "application/json", origin: new URL(link.url).origin },
				body: JSON.stringify({ annotations: [{ anchor: 1, comment: text, author }] }),
			});

		const first = await comment("alice", "first note");
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ ok: true, author: "alice" });
		// The island carries the bound name, which is what stops the name dialog.
		expect(islandOf(await (await fetch(link.url)).text()).author).toBe("alice");
	});

	test("a bound link cannot post under another reviewer's name", async () => {
		const seeded = "# Plan\n- [ ] one\n> [!REVIEW] @bob: theirs\n- [ ] two";
		const { review, content } = await startShared(
			{ mount: testMountSource("127.0.0.1") },
			{ canApprove: true },
			seeded,
		);
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");
		const post = (author: string, text: string) =>
			fetch(apiOf(link.url, "/api/comment"), {
				method: "POST",
				headers: { "content-type": "application/json", origin: new URL(link.url).origin },
				body: JSON.stringify({ annotations: [{ anchor: 1, comment: text, author }] }),
			});

		expect((await post("alice", "alice's note")).status).toBe(200);
		// A second tab of this link chose another name: it is stale, not authorized.
		const spoofed = await post("bob", "not mine");
		expect(spoofed.status).toBe(409);
		expect(await spoofed.json()).toMatchObject({ error: expect.stringContaining("@alice") });

		const text = content();
		expect(text).toContain("> [!REVIEW] @bob: theirs");
		expect(text).not.toContain("not mine");
	});

	test("a re-shared link may claim a name the revoked one released", async () => {
		const { review } = await startShared({ mount: testMountSource("127.0.0.1") }, { canApprove: true });
		const first = (await review.share())?.state.links[0];
		if (!first) throw new Error("no share link");
		await fetch(apiOf(first.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(first.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "a", author: "alice" }] }),
		});
		await review.stopSharing();
		const second = (await review.share())?.state.links[0];
		if (!second) throw new Error("no second share link");

		const response = await fetch(apiOf(second.url, "/api/comment"), {
			method: "POST",
			headers: { "content-type": "application/json", origin: new URL(second.url).origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "b", author: "alice" }] }),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, author: "alice" });
	});

	test("a repeating token generator cannot turn the owner's page into a reviewer's", async () => {
		const { review, session } = await startShared(
			{ networkInterfaces: LAN, token: () => "same" },
			{ canApprove: true },
		);
		expect((await review.share())?.state.sharing).toBe(true);

		const html = await (await fetch(session.url)).text();
		expect(html).toContain('id="share"');
		expect(html).not.toContain('id="reviewer-name"');
		expect(html).toContain('"role":"owner"');
	});

	test("a reviewer's save with nothing new changes nothing", async () => {
		const { review, content } = await startShared({ mount: testMountSource("127.0.0.1") }, { canApprove: true });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");
		const post = () =>
			fetch(apiOf(link.url, "/api/comment"), {
				method: "POST",
				headers: { "content-type": "application/json", origin: new URL(link.url).origin },
				body: JSON.stringify({ annotations: [{ anchor: 1, comment: "note", author: "priya" }] }),
			});

		expect((await post()).status).toBe(200);
		const before = content();
		expect((await post()).status).toBe(200);
		expect(content()).toBe(before);
	});

	test("mints one link per person, while sharing again re-reads the first", async () => {
		const { review, session } = await startShared({ mount: testMountSource("127.0.0.1") });
		const first = (await review.share())?.state.links[0];
		if (!first) throw new Error("no share link");

		const invited = (await (await ownerShares(session, "/api/share/link")).json()) as { share: ShareState };

		expect(invited.share.links.map((link) => link.id)).toEqual(["link-1", "link-2"]);
		expect(invited.share.links[1]?.url).not.toBe(first.url);
		// Share still re-reads what is already shared, so a stray click mints nothing.
		expect((await review.share())?.state.links[0]?.url).toBe(first.url);
	});

	test("two links post under their own names in one review", async () => {
		const { review, session, content } = await startShared({ mount: testMountSource("127.0.0.1") });
		const first = (await review.share())?.state.links[0];
		if (!first) throw new Error("no share link");
		const invited = (await (await ownerShares(session, "/api/share/link")).json()) as { share: ShareState };
		const second = invited.share.links[1];
		if (!second) throw new Error("no second share link");

		expect((await reviewerPost(first, "alice", "mine")).status).toBe(200);
		expect((await reviewerPost(second, "bob", "theirs")).status).toBe(200);

		const text = content();
		expect(text).toContain("> [!REVIEW] @alice: mine");
		expect(text).toContain("> [!REVIEW] @bob: theirs");
		// The owner can see who holds each link without asking anyone.
		expect(review.shareState()?.links.map((link) => link.name)).toEqual(["alice", "bob"]);
	});

	test("revoking one link ends only that link, and the others keep posting", async () => {
		const { review, session } = await startShared({ mount: testMountSource("127.0.0.1") });
		const first = (await review.share())?.state.links[0];
		if (!first) throw new Error("no share link");
		const invited = (await (await ownerShares(session, "/api/share/link")).json()) as { share: ShareState };
		const second = invited.share.links[1];
		if (!second) throw new Error("no second share link");
		const surviving = await fetch(apiOf(second.url, "/events"));
		const frame = nextFrame(surviving.body);

		const revoked = await ownerShares(session, "/api/share/revoke", { id: "link-1" });
		expect(revoked.status).toBe(200);

		// The revoked link stops answering and its reviewer's post is refused.
		expect((await fetch(first.url)).status).toBe(403);
		expect((await reviewerPost(first, "alice", "stale")).status).toBe(403);
		// The link that was not revoked is told nothing and can still post.
		expect(await Promise.race([frame, settle(60).then(() => "silent")])).toBe("silent");
		expect((await reviewerPost(second, "bob", "still here")).status).toBe(200);
	});

	test("revoking the last link stops sharing and closes the listener", async () => {
		const { review, session } = await startShared({ mount: testMountSource("127.0.0.1") });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const result = (await (await ownerShares(session, "/api/share/revoke", { id: link.id })).json()) as {
			share: ShareState;
		};

		expect(result.share).toEqual({ sharing: false, origin: "", links: [] });
		expect(review.shareState()?.sharing).toBe(false);
		// The shared listener is gone, so even a remembered token cannot reach it.
		await expect(fetch(link.url)).rejects.toThrow();
	});

	test("refuses a link id the review does not hold, and a body that names none", async () => {
		const { review, session } = await startShared({ mount: testMountSource("127.0.0.1") });
		await review.share();

		expect((await ownerShares(session, "/api/share/revoke", { id: "link-9" })).status).toBe(404);
		expect((await ownerShares(session, "/api/share/revoke", {})).status).toBe(400);
	});

	test("refuses a ninth link, and says why", async () => {
		const { review, session } = await startShared({ mount: testMountSource("127.0.0.1") });
		await review.share();
		for (let index = 1; index < MAX_SHARE_LINKS; index++) await ownerShares(session, "/api/share/link");

		const capped = (await (await ownerShares(session, "/api/share/link")).json()) as { share: ShareState };

		expect(capped.share.links).toHaveLength(MAX_SHARE_LINKS);
		expect(capped.share.reason).toContain(`${MAX_SHARE_LINKS} links`);
	});

	test("a reviewer cannot mint, revoke, or stop sharing", async () => {
		const { review } = await startShared({ mount: testMountSource("127.0.0.1") });
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		for (const route of ["/api/share/link", "/api/share/revoke", "/api/share/stop"]) {
			const response = await fetch(apiOf(link.url, route), {
				method: "POST",
				headers: { "content-type": "application/json", origin: new URL(link.url).origin },
				body: JSON.stringify({ id: link.id }),
			});
			expect(response.status).toBe(403);
		}
		expect(review.shareState()?.links).toHaveLength(1);
	});

	test("a second share reuses the link instead of minting another", async () => {
		const { review } = await startShared({ mount: testMountSource("127.0.0.1") });
		const first = (await review.share())?.state.links[0]?.url;
		const second = (await review.share())?.state.links[0]?.url;
		expect(second).toBe(first);
	});

	test("sharing twice from one review keeps one listener and one token", async () => {
		const { review } = await startShared({ mount: testMountSource("127.0.0.1") });
		const first = await review.share();
		const second = await review.share();
		expect(second?.state.links).toEqual(first?.state.links);
		expect(second?.state.sharing).toBe(true);
	});
});
