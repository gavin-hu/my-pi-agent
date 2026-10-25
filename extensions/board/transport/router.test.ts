/**
 * The board page's router: the routes, the guards in front of them, and the answer a
 * refused write gets.
 *
 * Driven directly, with a fake context, so every refusal is asserted without a
 * socket — and so the security cases (token, `Host`, origin, JSON-only) are pinned
 * where a future route cannot skip them.
 */

import { describe, expect, test } from "bun:test";
import { LOOPBACK_HOSTS, PAGE_CSP } from "../../../lib/http/index.ts";
import type { BoardView } from "../../../lib/board/view.ts";
import type { Card } from "../../../lib/board/card.ts";
import type { BoardRouterContext, PageWrite } from "./router.ts";
import { handleBoardRequest } from "./router.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";

/** A card that passes, so a case can change one thing. */
function card(overrides: Partial<Card> = {}): Card {
	return {
		v: 1,
		id: "4",
		title: "Billing webhook accepts orders",
		status: "todo",
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

/** The snapshot a fake view answers with. */
function view(): BoardView {
	return {
		me: { id: "s-lead", label: "billing-lead" },
		lanes: [
			{ status: "todo", cards: [card()] },
			{ status: "doing", cards: [] },
			{ status: "blocked", cards: [] },
			{ status: "done", cards: [] },
		],
		counts: { total: 1, todo: 1, doing: 0, blocked: 0, done: 0 },
		round: { owners: [], unassigned: [card()], unplanned: [], blocked: [], idle: [], done: [] },
		bytes: 512,
		sig: "4:1",
		where: "~/.pi/agent/board/abc",
	};
}

/** A router context that records what it was asked to do. */
function context() {
	const writes: PageWrite[] = [];
	const pages: string[] = [];
	const ctx: BoardRouterContext = {
		token: TOKEN,
		hosts: () => LOOPBACK_HOSTS,
		page: async (named) => {
			pages.push(named);
			return `<html data-view="${named}"></html>`;
		},
		script: "/* client */",
		view: async () => view(),
		write: async (request) => {
			writes.push(request);
			if (request.kind === "drop") return { ok: true, card: card() };
			if (request.kind === "claim")
				return {
					ok: false,
					status: 409,
					error: "#4 is held by billing-core.",
					card: card({ status: "doing", owner: { label: "billing-core" } }),
				};
			return { ok: true, card: card() };
		},
	};
	return { ctx, writes, pages };
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

	test("answers a favicon with no body", async () => {
		const { ctx } = context();
		expect((await handleBoardRequest(ctx, "GET", "/favicon.ico", SAME_ORIGIN)).status).toBe(204);
	});
});

describe("the token", () => {
	test("is required for the page, the snapshot, the stream, and every write", async () => {
		const { ctx } = context();
		for (const [method, path] of [
			["GET", "/"],
			["GET", "/api/board"],
			["GET", "/events"],
			["POST", "/api/cards"],
			["DELETE", "/api/cards/4"],
		] as const) {
			const response = await handleBoardRequest(
				ctx,
				method,
				path,
				{ ...SAME_ORIGIN, "content-type": "application/json" },
				"{}",
			);
			expect(response.status, `${method} ${path}`).toBe(403);
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
	test("refuses a method it does not serve, naming the ones it does", async () => {
		const { ctx } = context();
		const response = await handleBoardRequest(ctx, "PUT", url("/"), SAME_ORIGIN);
		expect(response.status).toBe(405);
		expect(response.headers.Allow).toBe("GET, HEAD, POST, DELETE");
	});

	test("refuses a foreign Host", async () => {
		const { ctx } = context();
		const response = await handleBoardRequest(ctx, "GET", url("/"), { host: "evil.example" });
		expect(response.status).toBe(403);
		expect(response.body).toContain("Unexpected Host header.");
	});

	test("refuses a write another site made", async () => {
		const { ctx } = context();
		const response = await handleBoardRequest(
			ctx,
			"POST",
			url("/api/cards"),
			{
				host: "127.0.0.1:4812",
				origin: "http://evil.example",
				"content-type": "application/json",
			},
			"{}",
		);
		expect(response.status).toBe(403);
		expect(response.body).toContain("Cross-origin request refused.");
	});

	test("refuses a body that is not JSON", async () => {
		const { ctx } = context();
		const form = await handleBoardRequest(
			ctx,
			"POST",
			url("/api/cards"),
			{ ...SAME_ORIGIN, "content-type": "application/x-www-form-urlencoded" },
			"title=x",
		);
		expect(form.status).toBe(415);
		const plain = await handleBoardRequest(ctx, "GET", url("/api/board"), {
			...SAME_ORIGIN,
			"content-type": "text/plain",
		});
		expect(plain.status).toBe(200);
	});

	test("refuses a body that is not an object", async () => {
		const { ctx } = context();
		const response = await handleBoardRequest(
			ctx,
			"POST",
			url("/api/cards"),
			{ ...SAME_ORIGIN, "content-type": "application/json" },
			"[1,2]",
		);
		expect(response.status).toBe(400);
	});
});

describe("the snapshot", () => {
	test("answers with the view the server built", async () => {
		const { ctx } = context();
		const response = await handleBoardRequest(ctx, "GET", url("/api/board"), SAME_ORIGIN);
		expect(response.status).toBe(200);
		expect(JSON.parse(String(response.body ?? "{}"))).toMatchObject({ sig: "4:1", counts: { total: 1 } });
	});

	test("opens the stream route as a stream", async () => {
		const { ctx } = context();
		const response = await handleBoardRequest(ctx, "GET", url("/events"), SAME_ORIGIN);
		expect(response.stream).toBe(true);
		expect(response.headers["Content-Type"]).toContain("text/event-stream");
	});
});

describe("the card routes", () => {
	test("add is a POST to the collection", async () => {
		const { ctx, writes } = context();
		const response = await handleBoardRequest(
			ctx,
			"POST",
			url("/api/cards"),
			{ ...SAME_ORIGIN, "content-type": "application/json" },
			'{"title":"One","paths":["src"]}',
		);
		expect(response.status).toBe(200);
		expect(writes).toEqual([{ kind: "add", body: { title: "One", paths: ["src"] } }]);
	});

	test("a verb is a POST naming one card", async () => {
		const { ctx, writes } = context();
		await handleBoardRequest(
			ctx,
			"POST",
			url("/api/cards/4/move"),
			{ ...SAME_ORIGIN, "content-type": "application/json" },
			'{"status":"blocked"}',
		);
		expect(writes).toEqual([{ kind: "move", id: "4", body: { status: "blocked" } }]);
	});

	test("edit is a verb like any other, carrying whichever fields the composer sent", async () => {
		const { ctx, writes } = context();
		await handleBoardRequest(
			ctx,
			"POST",
			url("/api/cards/4/edit"),
			{ ...SAME_ORIGIN, "content-type": "application/json" },
			'{"title":"Billing webhook","priority":"high"}',
		);
		expect(writes).toEqual([{ kind: "edit", id: "4", body: { title: "Billing webhook", priority: "high" } }]);
	});

	test("a refusal answers 409 with the card it left alone", async () => {
		const { ctx } = context();
		const response = await handleBoardRequest(
			ctx,
			"POST",
			url("/api/cards/4/claim"),
			{ ...SAME_ORIGIN, "content-type": "application/json" },
			"{}",
		);
		expect(response.status).toBe(409);
		expect(JSON.parse(String(response.body ?? "{}"))).toMatchObject({
			error: "#4 is held by billing-core.",
			card: { rev: 1 },
		});
	});

	test("drop is the one deletion", async () => {
		const { ctx, writes } = context();
		const response = await handleBoardRequest(ctx, "DELETE", url("/api/cards/4"), SAME_ORIGIN);
		expect(response.status).toBe(200);
		expect(writes).toEqual([{ kind: "drop", id: "4" }]);
	});

	test("refuses a GET on a card, and a POST on the collection's id", async () => {
		const { ctx } = context();
		expect((await handleBoardRequest(ctx, "GET", url("/api/cards/4"), SAME_ORIGIN)).status).toBe(405);
		expect(
			(
				await handleBoardRequest(
					ctx,
					"POST",
					url("/api/cards/4"),
					{ ...SAME_ORIGIN, "content-type": "application/json" },
					"{}",
				)
			).status,
		).toBe(405);
	});

	test("refuses a verb it does not have, and a path it does not serve", async () => {
		const { ctx } = context();
		const verb = await handleBoardRequest(
			ctx,
			"POST",
			url("/api/cards/4/archive"),
			{ ...SAME_ORIGIN, "content-type": "application/json" },
			"{}",
		);
		expect(verb.status).toBe(404);
		expect((await handleBoardRequest(ctx, "GET", url("/nope"), SAME_ORIGIN)).status).toBe(404);
	});
});
