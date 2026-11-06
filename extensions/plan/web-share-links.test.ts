/**
 * The links a running review hands out: the reviewer token each one carries, the
 * cap on how many there are, and what minting, revoking, and stopping do to the
 * listener and to the pages already open on it.
 */

import { describe, expect, test } from "bun:test";
import { settle } from "../../test/helpers/process.ts";
import { testMountSource } from "../../test/helpers/serve.ts";
import {
	apiOf,
	islandOf,
	nextFrame,
	ownerShares,
	reviewerPost,
	reviewSuite,
} from "../../test/helpers/fixtures/plan-web.ts";
import { MAX_SHARE_LINKS, type ShareState } from "./web-share.ts";
const { startShared } = reviewSuite();

describe("share links", () => {
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

	test("a reviewer's page posts with her own link's token, not the owner's", async () => {
		const { review, session, content } = await startShared({ mount: testMountSource("127.0.0.1") });
		const first = (await review.share())?.state.links[0];
		if (!first) throw new Error("no share link");
		const invited = (await (await ownerShares(session, "/api/share/link")).json()) as { share: ShareState };
		if (!invited.share.links[1]) throw new Error("no second share link");

		// The page a reviewer opens hands her one credential: her own link's token.
		const island = islandOf(await (await fetch(first.url)).text());
		expect(island.role).toBe("reviewer");
		expect(island.token).toBe(new URL(first.url).searchParams.get("token") ?? "");

		// What her page posts: the island's token, which is the only one the client sends.
		const postUrl = new URL(apiOf(first.url, "/api/comment"));
		postUrl.searchParams.set("token", island.token);
		const posted = await fetch(postUrl, {
			method: "POST",
			headers: { "content-type": "application/json", origin: postUrl.origin },
			body: JSON.stringify({ annotations: [{ anchor: 1, comment: "her note", author: "priya" }] }),
		});
		expect(posted.status).toBe(200);
		expect(content()).toContain("> [!REVIEW] @priya: her note");

		// Her stream is keyed by that same token, so the frame addressed to her link reaches
		// her rather than a tab the review counts as its owner's.
		const stream = await fetch(apiOf(first.url, "/events"));
		const frame = nextFrame(stream.body);
		expect((await ownerShares(session, "/api/share/revoke", { id: first.id })).status).toBe(200);
		expect(await frame).toBe("revoked");
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
