/**
 * The loopback review session: the page it serves from the plan, the baselines it
 * marks, the terminal responses it resolves, and the grace a dropped tab gets.
 */

import { describe, expect, test } from "bun:test";
import type { ArmTimer } from "../../lib/timer.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { testMountSource } from "../../test/helpers/serve.ts";
import {
	apiOf,
	approveUrl,
	cancelUrl,
	eventsUrl,
	feedbackUrl,
	islandOf,
	LAN,
	nextFrame,
	pagePost,
	reviewSuite,
} from "../../test/helpers/fixtures/plan-web.ts";
import { MAX_ANNOTATIONS, MAX_COMMENT_LENGTH, MAX_QUOTE_LENGTH } from "./feedback.ts";
import { sectionDigests } from "./plan-text.ts";
const { start, startShared } = reviewSuite();

describe("review session", () => {
	test("serves the review page from the plan", async () => {
		const session = await start("# Plan\n");
		const response = await fetch(session.url);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('id="review-data"');
	});

	test("highlights a fenced code block and builds the outline", async () => {
		const session = await start("# Plan\n\n```ts\nconst x = 1;\n```\n");
		const data = islandOf(await (await fetch(session.url)).text());

		const [key, lines] = Object.entries(data.code)[0] ?? [];
		expect(key).toBeDefined();
		expect(lines?.join("")).toContain("tok-keyword");
		expect(data.outline).toEqual([{ id: "s-0", line: 0, level: 1, text: "Plan" }]);
	});

	test("reports the Steps section progress, not every checkbox", async () => {
		const plan = [
			"# Plan",
			"## Context",
			"- [ ] not a step",
			"## Steps",
			"- [x] Done one",
			"- [ ] Pending one",
			"## Verification",
			"- [ ] not a step either",
		].join("\n");
		const session = await start(plan);
		const data = islandOf(await (await fetch(session.url)).text());

		expect(data.steps).toEqual({ done: 1, total: 2 });
	});

	test("marks the outline section that changed since the previous review", async () => {
		const session = await start("# Plan\n\nNew body\n", { baseline: sectionDigests("# Plan\n\nOld body\n") });
		const data = islandOf(await (await fetch(session.url)).text());

		expect(data.outline).toEqual([{ id: "s-0", line: 0, level: 1, text: "Plan", changed: true }]);
	});

	test("marks the blocks that changed, in the lines the page draws", async () => {
		const plan = ["# Plan", "", "Kept.", "", "Edited now."].join("\n");
		const previous = ["# Plan", "", "Kept.", "", "Edited."].join("\n");
		const session = await start(plan, { baseline: sectionDigests(previous) });
		const data = islandOf(await (await fetch(session.url)).text());

		// The heading is line 0, "Kept." line 2, the edited paragraph line 4: only the
		// paragraph is new to this review, and the mark names the line the page draws.
		expect(data.changed).toEqual([4]);
		expect(data.blockMarks).toBe(true);
	});

	test("says a section lost blocks, which a document cannot draw in place", async () => {
		const plan = ["# Plan", "", "One."].join("\n");
		const previous = ["# Plan", "", "One.", "", "Two."].join("\n");
		const session = await start(plan, { baseline: sectionDigests(previous) });
		const data = islandOf(await (await fetch(session.url)).text());

		expect(data.outline).toEqual([{ id: "s-0", line: 0, level: 1, text: "Plan", changed: true, removed: 1 }]);
	});

	test("marks no blocks against a baseline written before block marks", async () => {
		// A baseline with section digests but no block digests is honoured at the depth it
		// can be: the section dot, and no guessed block marks.
		const aged = sectionDigests("# Plan\n\nOld body\n").map((section) => ({
			title: section.title,
			digest: section.digest,
		}));
		const session = await start("# Plan\n\nNew body\n", { baseline: aged });
		const data = islandOf(await (await fetch(session.url)).text());

		expect(data.changed).toBeUndefined();
		expect(data.blockMarks).toBeUndefined();
		expect(data.outline[0]?.changed).toBe(true);
	});

	test("marks only the occurrence of a duplicate heading that changed", async () => {
		const plan = ["# Plan", "## Notes", "a", "## Notes", "b"].join("\n");
		const previous = ["# Plan", "## Notes", "a", "## Notes", "B"].join("\n");
		const session = await start(plan, { baseline: sectionDigests(previous) });
		const data = islandOf(await (await fetch(session.url)).text());

		expect(data.outline.map((item) => item.changed === true)).toEqual([false, false, true]);
	});

	test("uses the plan's H1 as the review title and falls back to the slug", async () => {
		const titled = await start("# Add rate limiting\n\nBody\n");
		expect(islandOf(await (await fetch(titled.url)).text()).title).toBe("Add rate limiting");

		const untitled = await start("Just prose, no heading.\n");
		expect(islandOf(await (await fetch(untitled.url)).text()).title).toBe("demo");
	});

	test("keys a tab's draft on the plan text it rendered", async () => {
		const session = await start("# Plan\n\nbody\n");
		const rev = islandOf(await (await fetch(session.url)).text()).rev;
		expect(rev).toBeTruthy();
		// The same text keeps the same key, so a reload restores the draft.
		expect(islandOf(await (await fetch(session.url)).text()).rev).toBe(rev);

		const rewritten = await start("# Plan\n\nother body\n");
		expect(islandOf(await (await fetch(rewritten.url)).text()).rev).not.toBe(rev);
	});

	test("rejects a request without the session token", async () => {
		const session = await start();
		// The page, addressed without its credential: the token is the only thing that
		// opens a review.
		const bare = new URL(session.url);
		bare.search = "";
		const response = await fetch(bare.toString());
		expect(response.status).toBe(403);
	});

	test("resolves saved with the annotations written into the plan", async () => {
		const session = await start();
		const response = await pagePost(session, "/api/feedback", {
			annotations: [{ anchor: 2, comment: "make it concrete" }],
		});

		expect(response.status).toBe(200);
		const result = await session.done;
		expect(result.status).toBe("saved");
		if (result.status === "saved") {
			expect(result.annotations).toEqual([{ anchor: 2, comment: "make it concrete" }]);
			expect(result.plan.content).toContain("> [!REVIEW] make it concrete");
		}
	});

	test("keeps the moved flag on a comment the page posts back", async () => {
		// A refinement carried the note onto another block, and the page is the only place
		// that still knows. A save must not rewrite it as though it sat there all along.
		const session = await start("# Plan\n\nA paragraph.\n");
		const response = await pagePost(session, "/api/feedback", {
			annotations: [{ anchor: 2, comment: "check this", moved: true }],
		});

		expect(response.status).toBe(200);
		const result = await session.done;
		expect(result.status).toBe("saved");
		if (result.status === "saved") expect(result.plan.content).toContain("> [!REVIEW moved] check this");
	});

	test("keeps the resolved flag on a note the page posts back", async () => {
		// Settling is the reader's decision, and the page is where it was made: a save that
		// dropped the flag would hand a closed question back to the model as an open one.
		const session = await start("# Plan\n\nA paragraph.\n");
		const response = await pagePost(session, "/api/feedback", {
			annotations: [{ anchor: 2, comment: "answered", resolved: true }],
		});

		expect(response.status).toBe(200);
		const result = await session.done;
		expect(result.status).toBe("saved");
		if (result.status === "saved") expect(result.plan.content).toContain("> [!REVIEW resolved] answered");
	});

	test("resolves cancelled when the user cancels", async () => {
		const session = await start();
		expect((await fetch(cancelUrl(session), { method: "POST" })).status).toBe(200);
		expect((await session.done).status).toBe("cancelled");
	});

	test("resolves approved with the saved comments", async () => {
		const session = await start("# Plan\n\n- [ ] step\n", { canApprove: true });
		const response = await pagePost(session, "/api/approve", { annotations: [{ anchor: 2, comment: "ship it" }] });

		expect(response.status).toBe(200);
		const result = await session.done;
		expect(result.status).toBe("approved");
		if (result.status === "approved") {
			expect(result.annotations).toEqual([{ anchor: 2, comment: "ship it" }]);
			expect(result.plan.content).toContain("> [!REVIEW] ship it");
		}
	});

	test("refuses approve when the session is comment-only", async () => {
		const session = await start();
		const response = await pagePost(session, "/api/approve", { annotations: [] });
		expect(response.status).toBe(403);

		await fetch(cancelUrl(session), { method: "POST" });
		expect((await session.done).status).toBe("cancelled");
	});

	test("offers the approve action only when the session allows it", async () => {
		const approvable = await start("# Plan\n", { canApprove: true });
		expect(await (await fetch(approvable.url)).text()).toContain('id="approve"');

		const commentOnly = await start("# Plan\n");
		expect(await (await fetch(commentOnly.url)).text()).not.toContain('id="approve"');
	});

	test("delivers every terminal response before the session closes", async () => {
		const cases = [
			{
				canApprove: false,
				url: feedbackUrl,
				body: JSON.stringify({ annotations: [{ anchor: 0, comment: "note" }] }),
				status: "saved",
			},
			{
				canApprove: true,
				url: approveUrl,
				body: JSON.stringify({ annotations: [{ anchor: 0, comment: "go" }] }),
				status: "approved",
			},
			{ canApprove: false, url: cancelUrl, body: undefined, status: "cancelled" },
		] as const;

		for (const item of cases) {
			const session = await start("# Plan\n", { canApprove: item.canApprove });
			const init: RequestInit = { method: "POST" };
			if (item.body) {
				init.headers = { "Content-Type": "application/json" };
				init.body = item.body;
			}
			const pending = fetch(item.url(session), init);

			expect((await session.done).status).toBe(item.status);
			await session.close();
			expect((await pending).status).toBe(200);
		}
	});

	test("resolves cancelled when the turn aborts", async () => {
		const controller = new AbortController();
		const session = await start("# Plan\n", { signal: controller.signal });

		controller.abort();
		expect((await session.done).status).toBe("cancelled");
	});

	test("a reload that reconnects inside the grace does not cancel the review", async () => {
		// The grace is a timer, so the test owns it: a real deadline of a few tens of
		// milliseconds fails on a loaded runner, which says nothing about the code.
		let armed: (() => void) | undefined;
		const schedule: ArmTimer = (_ms, fn) => {
			armed = fn;
			return () => {
				if (armed === fn) armed = undefined;
			};
		};
		const session = await start("# Plan\n", {}, { schedule });
		const events = eventsUrl(session);

		// The page loads, then reloads: its stream drops and a new one arrives.
		const first = new AbortController();
		const page = await fetch(events, { signal: first.signal });
		expect(page.status).toBe(200);
		await page.body?.getReader().read();
		first.abort();
		await waitFor(() => armed !== undefined);

		// A dropped stream is a question with a deadline, not a decision.
		const pending = armed;
		expect(pending).toBeDefined();

		const second = new AbortController();
		expect((await fetch(events, { signal: second.signal })).status).toBe(200);
		await waitFor(() => armed === undefined);

		// The reload got in: the grace that was armed for the first stream is gone.
		pending?.();
		const outcome = await Promise.race([session.done.then(() => "settled"), settle(20).then(() => "pending")]);
		expect(outcome).toBe("pending");

		// Closing the tab for real is a drop nobody answers.
		second.abort();
		await waitFor(() => armed !== undefined);
		armed?.();
		expect((await session.done).status).toBe("cancelled");
	});

	test("a reviewer's dropped stream neither arms nor ends the review", async () => {
		let armed: (() => void) | undefined;
		const schedule: ArmTimer = (_ms, fn) => {
			armed = fn;
			return () => {
				if (armed === fn) armed = undefined;
			};
		};
		const { review, session } = await startShared({ networkInterfaces: LAN, schedule }, {});
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		// The reviewer's page loads, then that tab closes.
		const reviewer = new AbortController();
		const page = await fetch(apiOf(link.url, "/events"), { signal: reviewer.signal });
		expect(page.status).toBe(200);
		await page.body?.getReader().read();
		reviewer.abort();
		await settle(50);

		// The review's lifetime is the owner's page, not the reviewer's.
		expect(armed).toBeUndefined();
		const outcome = await Promise.race([session.done.then(() => "settled"), settle(20).then(() => "pending")]);
		expect(outcome).toBe("pending");
	});

	test("a reviewer's reconnect does not cancel the owner's pending teardown", async () => {
		let armed: (() => void) | undefined;
		const schedule: ArmTimer = (_ms, fn) => {
			armed = fn;
			return () => {
				if (armed === fn) armed = undefined;
			};
		};
		const { review, session } = await startShared({ networkInterfaces: LAN, schedule }, {});
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		// The owner's tab closes, arming the teardown.
		const owner = new AbortController();
		const page = await fetch(eventsUrl(session), { signal: owner.signal });
		expect(page.status).toBe(200);
		await page.body?.getReader().read();
		owner.abort();
		await waitFor(() => armed !== undefined);
		const pending = armed;

		// A reviewer opens the shared link before the grace fires.
		const reviewer = new AbortController();
		expect((await fetch(apiOf(link.url, "/events"), { signal: reviewer.signal })).status).toBe(200);
		await settle(20);
		expect(armed).toBe(pending);

		pending?.();
		expect((await session.done).status).toBe("cancelled");
		reviewer.abort();
	});

	test("stop sharing tells a reviewer why and leaves the review open", async () => {
		const { review, session } = await startShared({ mount: testMountSource("127.0.0.1") }, {});
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const stream = await fetch(apiOf(link.url, "/events"));
		const frame = nextFrame(stream.body);

		await review.stopSharing();
		expect(await frame).toBe("revoked");
		// Revoking the link is not a decision about the plan.
		const outcome = await Promise.race([session.done.then(() => "settled"), settle(20).then(() => "pending")]);
		expect(outcome).toBe("pending");
		expect((await fetch(session.url)).status).toBe(200);
	});

	test("closing the review tells a reviewer why it stopped", async () => {
		const { review, session } = await startShared({ mount: testMountSource("127.0.0.1") }, {});
		const link = (await review.share())?.state.links[0];
		if (!link) throw new Error("no share link");

		const stream = await fetch(apiOf(link.url, "/events"));
		const frame = nextFrame(stream.body);

		await session.close();
		expect(await frame).toBe("closed");
	});

	test("rejects an oversize body with a JSON 413, not a dropped connection", async () => {
		const session = await start("# Plan\n", {}, { maxBodyBytes: 64 });
		const response = await pagePost(session, "/api/feedback", {
			annotations: [{ anchor: 0, comment: "x".repeat(200) }],
		});

		expect(response.status).toBe(413);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	test("hands the client the server's own caps", async () => {
		const session = await start("# Plan\n");
		const data = islandOf(await (await fetch(session.url)).text());

		expect(data.limits).toEqual({
			comments: MAX_ANNOTATIONS,
			comment: MAX_COMMENT_LENGTH,
			quote: MAX_QUOTE_LENGTH,
		});
	});

	test("close is idempotent", async () => {
		const session = await start();
		await session.close();
		await session.close();
		expect((await session.done).status).toBe("cancelled");
	});
});
