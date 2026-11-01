/**
 * The review's route table, driven from the table itself.
 *
 * A route declares its access, whether it reads a body, and the sentence another role reads,
 * and the dispatcher checks all three in one place. So these cases iterate the table instead
 * of naming paths: an eighth route is covered the moment it is listed, which is what the
 * split buys — the alternative was the eighth hand-written `if` the chain used to invite,
 * with its author remembering the order of four guards.
 */

import { describe, expect, test } from "bun:test";
import { HOST, LOOPBACK_PEER, router } from "../../test/helpers/fixtures/plan-web.ts";
import { handleReviewRequest, REVIEW_ROUTES } from "./web-router.ts";

/** A peer that is not this machine, as `lib/http/guard.ts` reads one. */
const LAN_PEER = "10.0.0.7";

/** The reviewer the fixture's bus hands out, so a route is called by the role it names. */
const reviewerRouter = () =>
	router({ caller: (token) => (token === "tok" ? { role: "reviewer" as const, name: "rina" } : undefined) });

/** A POST the page's way, from `peer`: every body-taking route is sent JSON. */
const postFrom = (
	ctx: Parameters<typeof handleReviewRequest>[0],
	path: string,
	peer: string,
	body: string = JSON.stringify({ annotations: [] }),
) => handleReviewRequest(ctx, "POST", `${path}?token=tok`, { ...HOST, "content-type": "application/json" }, body, peer);

/** The body a route needs to get past its own handler: revoke names a link, the rest settle. */
const bodyFor = (path: string): string | undefined =>
	path === "/api/share/revoke" ? JSON.stringify({ id: "link-1" }) : undefined;

describe("the route table", () => {
	test("names each path once", () => {
		const paths = REVIEW_ROUTES.map((route) => route.path);
		// A duplicate would shadow the second row, and the shadowed route would answer with the
		// first one's guard: the exact drift the table exists to stop.
		expect(new Set(paths).size).toBe(paths.length);
	});

	test("refuses a method it does not serve, and says which verb to use", async () => {
		for (const route of REVIEW_ROUTES) {
			const response = await handleReviewRequest(
				router().ctx,
				"GET",
				`${route.path}?token=tok`,
				HOST,
				"",
				LOOPBACK_PEER,
			);
			expect(response.status, route.path).toBe(405);
			expect(response.body, route.path).toContain(`Use POST to ${route.phrase}.`);
		}
	});

	test("refuses a body a form could send, on every route that reads one", async () => {
		const readers = REVIEW_ROUTES.filter((route) => route.body === "json");
		expect(readers.length).toBeGreaterThan(0);
		for (const route of readers) {
			for (const contentType of ["text/plain", "application/x-www-form-urlencoded", undefined]) {
				const headers = contentType === undefined ? HOST : { ...HOST, "content-type": contentType };
				const response = await handleReviewRequest(
					router().ctx,
					"POST",
					`${route.path}?token=tok`,
					headers,
					"annotations=[]",
					LOOPBACK_PEER,
				);
				expect(response.status, `${route.path} ${String(contentType)}`).toBe(415);
				expect(response.body, route.path).toContain("The request body must be JSON.");
			}
		}
	});

	test("refuses a reviewer on every owner route, and answers the reviewer's own", async () => {
		const reviewer = reviewerRouter();
		for (const route of REVIEW_ROUTES) {
			const response = await postFrom(reviewer.ctx, route.path, LOOPBACK_PEER);
			if (route.access === "owner") {
				expect(response.status, route.path).toBe(403);
				expect(response.body, route.path).toContain(route.refusal);
				continue;
			}
			expect(response.status, route.path).toBe(200);
		}
		// A reviewer posts comments and ends nothing: no owner route ran for her.
		expect(reviewer.ownerSaves).toEqual([]);
		expect(reviewer.approved).toEqual([]);
		expect(reviewer.cancelled).toEqual([]);
	});

	test("answers an owner on this machine and refuses the same caller from the network", async () => {
		const { ctx } = router();
		for (const route of REVIEW_ROUTES.filter((entry) => entry.access === "owner")) {
			const own = await postFrom(ctx, route.path, LOOPBACK_PEER, bodyFor(route.path));
			expect(own.status, route.path).toBe(200);
			const remote = await postFrom(router().ctx, route.path, LAN_PEER, bodyFor(route.path));
			expect(remote.status, route.path).toBe(403);
			expect(remote.body, route.path).toContain("answers only on the machine serving the review");
		}
	});

	test("answers a reviewer's route from the network, which is what a shared link is for", async () => {
		const reviewer = reviewerRouter();
		const shared = REVIEW_ROUTES.filter((route) => route.access === "reviewer");
		expect(shared.length).toBeGreaterThan(0);
		for (const route of shared) {
			const response = await postFrom(reviewer.ctx, route.path, LAN_PEER);
			expect(response.status, route.path).toBe(200);
		}
	});

	test("answers 404 for a path the table does not name", async () => {
		const response = await postFrom(router().ctx, "/api/nonexistent", LOOPBACK_PEER);
		expect(response.status).toBe(404);
	});
});
