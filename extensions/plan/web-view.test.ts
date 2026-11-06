/**
 * The plan page as a reader sees it: the view `/plan list`'s Enter opens.
 *
 * A view is the review's page with the deciding half removed, so what has to hold is
 * negative at every layer — the router refuses a viewer's token on every route in the
 * table, the page's markup carries no control that writes, and the session ends itself
 * when its only page goes away rather than waiting for a decision nobody will make. The
 * browser case drives the shipped page, because the client is a string no compiler sees
 * and a source scan cannot tell a wired handler from a documented one.
 *
 * Where the machine has no browser the last suite skips, naming `PI_CHROME`, so
 * `bun run check` stays green there and still says why nothing ran.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser } from "playwright-core";
import type { ArmTimer } from "../../lib/timer.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { eventsUrl, islandOf, reviewPage, reviewSuite, router } from "../../test/helpers/fixtures/plan-web.ts";
import {
	launchReviewBrowser,
	mountReview,
	REVIEW_CHROME,
	REVIEW_PAGE,
	REVIEW_PAINT_MS,
} from "../../test/helpers/plan-browser.ts";
import { formatFeedback } from "./feedback.ts";
import type { ReviewCaller } from "./types.ts";
import { reviewPageData, type ReviewPageData } from "./web-payload.ts";
import { handleReviewRequest, REVIEW_ROUTES } from "./web-router.ts";

const { startShared } = reviewSuite();

/** The caller a view's page is served for. */
const VIEWER: ReviewCaller = { role: "viewer" };

/** The island a reader's page is built from: the fixture's plan, read by a viewer. */
const VIEWER_PAGE: Partial<ReviewPageData> = { role: "viewer", canApprove: false, share: undefined };

/** Every control, dialog, and region a page that writes carries, and a view must not. */
const WRITE_MARKUP = [
	'id="approve"',
	'id="save"',
	'id="post"',
	'id="cancel"',
	'id="share"',
	'id="reviewer-name"',
	'class="bf-app__bar',
	'id="approve-dialog"',
	'id="share-dialog"',
	'id="name-dialog"',
];

describe("a viewer's island", () => {
	test("names the viewer, and gives it no decision and no share", () => {
		const content = formatFeedback("# Plan\n\nBody\n", [{ anchor: 2, comment: "why" }]);
		const data = reviewPageData({
			base: "",
			path: "~/.pi/agent/plans/probe/plan.md",
			content,
			caller: VIEWER,
			token: "tok",
			// The page it *could* have had, said out loud: a view is not an approval flow, and
			// the flag the server passes cannot change that.
			canApprove: true,
			share: () => ({ sharing: true, origin: "http://192.168.1.24:1", links: [] }),
		});

		expect(data.role).toBe("viewer");
		expect(data.canApprove).toBe(false);
		expect(data.share).toBeUndefined();
		// Reading a plan includes the notes already in it: they are the file's own text.
		expect(data.annotations.map((annotation) => annotation.comment)).toEqual(["why"]);
	});
});

describe("a viewer's page", () => {
	test("draws no control that writes, and no dialog that would", () => {
		const html = reviewPage(VIEWER_PAGE);
		for (const markup of WRITE_MARKUP) expect(html).not.toContain(markup);
		// The absence is complete rather than an empty bar with a rule under it: the bar's own
		// class is what a review renders, and the stylesheet's copy of the name is not markup.
		expect(html).not.toContain('<div class="bf-app__bar');
	});

	test("names the page a view, and says what it is", () => {
		const html = reviewPage(VIEWER_PAGE);
		expect(html).toContain("plan view");
		expect(html).toContain("<strong>View only</strong>");
		// The facts a reader is owed stay: the plan's step progress and its comment count.
		expect(html).toContain('id="step-fact"');
		expect(html).toContain('id="comment-total"');
	});
});

describe("a viewer's token", () => {
	test("is refused on every route that writes, and answered on the page", async () => {
		const { ctx } = router({ caller: (token) => (token === "tok" ? VIEWER : undefined) });
		expect(REVIEW_ROUTES.length).toBeGreaterThan(0);
		for (const route of REVIEW_ROUTES) {
			// The role in the table is the whole guard: no route names a viewer, so every one of
			// them refuses it — the approving ones and a reviewer's post alike.
			const refused = await handleReviewRequest(
				ctx,
				"POST",
				`${route.path}?token=tok`,
				{ host: "127.0.0.1:1234", "content-type": "application/json" },
				"{}",
				"127.0.0.1",
			);
			expect({ path: route.path, status: refused.status }).toEqual({ path: route.path, status: 403 });
		}
		expect((await handleReviewRequest(ctx, "GET", "/?token=tok", { host: "127.0.0.1:1234" })).status).toBe(200);
	});
});

describe("a view session", () => {
	test("serves the page a viewer's island, and no share surface", async () => {
		const { review, session } = await startShared({}, { mode: "view" });
		const data = islandOf(await (await fetch(session.url)).text());

		expect(data.role).toBe("viewer");
		expect(data.canApprove).toBe(false);
		// A view is not the session's shareable review, so the controls that mint links answer
		// nothing for it — there is no page of its role that could ask.
		expect(review.shareState()).toBeUndefined();
		expect(await review.share()).toBeUndefined();
		expect(await review.stopSharing()).toBeUndefined();
	});

	test("ends itself when its only page goes away, releasing the port", async () => {
		let armed: (() => void) | undefined;
		const schedule: ArmTimer = (_ms, fn) => {
			armed = fn;
			return () => {
				if (armed === fn) armed = undefined;
			};
		};
		const { session } = await startShared({ schedule }, { mode: "view" });

		// The reader's tab loads the page and its stream, then closes.
		const reader = new AbortController();
		const stream = await fetch(eventsUrl(session), { signal: reader.signal });
		expect(stream.status).toBe(200);
		await stream.body?.getReader().read();
		reader.abort();

		// A view has no decision to settle, so its closed page is the session's end — and the
		// grace a reload needs still runs first.
		await waitFor(() => armed !== undefined);
		const outcome = await Promise.race([session.done.then(() => "settled"), settle(20).then(() => "pending")]);
		expect(outcome).toBe("pending");
		armed?.();
		expect((await session.done).status).toBe("cancelled");
		// Nothing awaits `done` in a view, so the release has to happen here: a session that
		// only settled would hold its prefix and its socket for the session's whole life.
		expect(
			await fetch(session.url).then(
				() => false,
				() => true,
			),
		).toBe(true);
	});

	test("is closed by closeAll at session shutdown", async () => {
		const { review, session } = await startShared({}, { mode: "view" });
		await review.closeAll();
		expect((await session.done).status).toBe("cancelled");
	});
});

describe.skipIf(REVIEW_CHROME === undefined)("the served view", () => {
	let browser: Browser;
	let viewUrl = "";
	let closeView: () => Promise<void> = async () => {};

	beforeAll(async () => {
		const started = await mountReview(
			{ ...REVIEW_PAGE, ...VIEWER_PAGE },
			// The real server's answer for this token: a viewer, refused on every write route.
			{ caller: (token) => (token === "tok" ? VIEWER : undefined) },
		);
		viewUrl = started.url;
		closeView = started.close;
		browser = await launchReviewBrowser();
	}, 30_000);

	afterAll(async () => {
		await browser?.close();
		await closeView();
	}, 30_000);

	test("renders the plan, offers nothing to press, and logs no error", async () => {
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
		await page.goto(viewUrl, { waitUntil: "load" });
		await page.waitForSelector("#plan .bf-block", { timeout: REVIEW_PAINT_MS });

		// The document is the review's: the same blocks, outline, and facts a reader came for.
		expect(await page.locator("#plan .bf-block").count()).toBe(4);
		expect(await page.textContent("#plan-title")).toBe("Add rate limiting");
		expect(await page.textContent("#step-count")).toContain("1/3");
		expect(await page.textContent(".review-finish")).toContain("View only");

		// And nothing that writes: no control, no bar to hold one, no dialog behind a key.
		for (const selector of ["#approve", "#save", "#post", "#cancel", "#share", "#reviewer-name"]) {
			expect(await page.locator(selector).count()).toBe(0);
		}
		expect(await page.locator(".review-actions").count()).toBe(0);
		// A viewer's own page opens no composer: the rail's button is not drawn at all, so
		// hovering a block cannot reveal one.
		await page.locator("#plan .bf-block").first().hover();
		expect(await page.locator(".bf-block__add").count()).toBe(0);
		// The stored note renders read-only: its controls belong to whoever wrote it, and a
		// name in this browser's storage is not a claim to a note.
		expect(await page.locator(".bf-comment").count()).toBe(1);
		expect(await page.locator(".bf-comment__actions").count()).toBe(0);

		expect(errors).toEqual([]);
	});
});
