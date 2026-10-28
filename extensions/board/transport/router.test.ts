/**
 * The board page's router: the reads it serves, and the guards in front of them.
 *
 * Driven directly, with a fake context, so every refusal is asserted without a socket —
 * and so the security cases (token, `Host`, method) are pinned where a future route cannot
 * skip them. A page that cannot write is a page whose write half is absent, not disabled,
 * so what these cases hold is the *absence*: no method, no path, no body.
 */

import { describe, expect, test } from "bun:test";
import { LOOPBACK_HOSTS, PAGE_CSP } from "../../../lib/http/index.ts";
import { buildView, type BoardView } from "../../../lib/board/view.ts";
import type { Card } from "../../../lib/board/card.ts";
import type { BoardRouterContext } from "./router.ts";
import { handleBoardRequest } from "./router.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";

/** A card that passes, so a case can change one thing. */
function card(overrides: Partial<Card> = {}): Card {
	return {
		v: 2,
		id: "4",
		title: "Billing webhook accepts orders",
		lane: "backlog",
		paths: ["src/billing"],
		notes: [],
		notesDropped: 0,
		rev: 1,
		createdAt: 1_000,
		updatedAt: 1_000,
		by: "billing-lead",
		...overrides,
	};
}

/** The snapshot a fake view answers with. Its one card is ordinary and waits on nothing. */
function view(): BoardView {
	return buildView({
		me: { id: "s-lead", label: "billing-lead" },
		cards: [card({ priority: "normal" })],
		now: 1_000,
		bytes: 512,
		where: "board/abc123",
		repo: "my-pi-agent",
		root: "/Users/someone/my-pi-agent",
	});
}

/** A router context that records the pages it was asked for. */
function context() {
	const pages: string[] = [];
	const ctx: BoardRouterContext = {
		read: (given) => given === TOKEN,
		hosts: () => LOOPBACK_HOSTS,
		page: async (named) => {
			pages.push(named);
			return `<html data-view="${named}"></html>`;
		},
		script: "/* client */",
		view: async () => view(),
	};
	return { ctx, pages };
}

/** The headers a page's own request carries. */
const SAME_ORIGIN = { host: "127.0.0.1:4812", origin: "http://127.0.0.1:4812" };

/** One request with the token in the query string. */
function url(path: string): string {
	return `${path}${path.includes("?") ? "&" : "?"}token=${TOKEN}`;
}

describe("the document and the static routes", () => {
	test("serves the page under the shared page policy", async () => {
		const { ctx, pages } = context();
		const response = await handleBoardRequest(ctx, "GET", url("/"), SAME_ORIGIN);
		expect(response.status).toBe(200);
		expect(response.headers["Content-Security-Policy"]).toBe(PAGE_CSP);
		expect(response.body).toContain('data-view="board"');
		expect(pages).toEqual(["board"]);
	});

	test("opens the Team tab from ?view=team, and anything else is the board", async () => {
		const { ctx, pages } = context();
		await handleBoardRequest(ctx, "GET", url("/?view=team"), SAME_ORIGIN);
		await handleBoardRequest(ctx, "GET", url("/?view=elsewhere"), SAME_ORIGIN);
		expect(pages).toEqual(["team", "board"]);
	});

	test("serves the client and the theme script without a token", async () => {
		const { ctx } = context();
		const script = await handleBoardRequest(ctx, "GET", "/app.js", SAME_ORIGIN);
		expect(script.status).toBe(200);
		expect(script.headers["Content-Type"]).toContain("javascript");
		expect(script.body).toBe("/* client */");
		const theme = await handleBoardRequest(ctx, "GET", "/theme.js", SAME_ORIGIN);
		expect(theme.status).toBe(200);
	});

	test("answers a favicon request as the unknown route it is", async () => {
		// The head links the mark as a data URI, so a browser never asks for the file the
		// route used to stand in for. What is left is one more path the board does not
		// serve: a token, then the same 404 every unknown route gets.
		const { ctx } = context();
		expect((await handleBoardRequest(ctx, "GET", url("/favicon.ico"), SAME_ORIGIN)).status).toBe(404);
	});
});

describe("the liveness route", () => {
	test("answers without reading the snapshot", async () => {
		const { ctx } = context();
		let views = 0;
		const counted: BoardRouterContext = { ...ctx, view: async () => (views++, view()) };
		const response = await handleBoardRequest(counted, "GET", url("/api/ping"), SAME_ORIGIN);
		expect(response.status).toBe(200);
		expect(response.body).toContain('"ok":true');
		// The point of the route: a probe must not wait behind a store read.
		expect(views).toBe(0);
	});

	test("is behind the same token as every other read", async () => {
		const { ctx } = context();
		expect((await handleBoardRequest(ctx, "GET", "/api/ping", SAME_ORIGIN)).status).toBe(403);
	});
});

describe("the token", () => {
	test("is required for the page, the snapshot, and the stream", async () => {
		const { ctx } = context();
		for (const path of ["/", "/api/board", "/events"]) {
			expect((await handleBoardRequest(ctx, "GET", path, SAME_ORIGIN)).status, path).toBe(403);
		}
	});

	test("refuses a wrong token, a missing one, and the empty string", async () => {
		const { ctx } = context();
		for (const path of ["/?token=", "/?token=nope", "/"]) {
			expect((await handleBoardRequest(ctx, "GET", path, SAME_ORIGIN)).status, path).toBe(403);
		}
	});
});

describe("the request envelope", () => {
	test("serves no method that could change a card, and says which two it does", async () => {
		const { ctx } = context();
		for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
			const response = await handleBoardRequest(ctx, method, url("/api/cards/4"), SAME_ORIGIN);
			expect(response.status, method).toBe(405);
			expect(response.headers.Allow, method).toBe("GET, HEAD");
		}
	});

	test("refuses a foreign Host", async () => {
		const { ctx } = context();
		const response = await handleBoardRequest(ctx, "GET", url("/"), { host: "evil.example" });
		expect(response.status).toBe(403);
		expect(response.body).toContain("Unexpected Host header.");
	});
});

describe("what the page does not have", () => {
	test("has no card route at all, under either method a browser can make", async () => {
		const { ctx } = context();
		for (const path of ["/api/cards", "/api/cards/4", "/api/cards/4/claim", "/api/cards/4/drop"]) {
			expect((await handleBoardRequest(ctx, "GET", url(path), SAME_ORIGIN)).status, path).toBe(404);
		}
	});

	test("answers a path it does not serve with the same refusal", async () => {
		const { ctx } = context();
		const response = await handleBoardRequest(ctx, "GET", url("/nope"), SAME_ORIGIN);
		expect(response.status).toBe(404);
		expect(response.body).toContain("That page does not exist.");
	});
});

describe("the snapshot", () => {
	test("answers with the view the server built", async () => {
		const { ctx } = context();
		const response = await handleBoardRequest(ctx, "GET", url("/api/board"), SAME_ORIGIN);
		expect(response.status).toBe(200);
		expect(JSON.parse(String(response.body ?? "{}"))).toMatchObject({ sig: "4:1|skipped:", total: 1 });
	});

	test("opens the stream route as a stream", async () => {
		const { ctx } = context();
		const response = await handleBoardRequest(ctx, "GET", url("/events"), SAME_ORIGIN);
		expect(response.stream).toBe(true);
		expect(response.headers["Content-Type"]).toContain("text/event-stream");
	});
});
