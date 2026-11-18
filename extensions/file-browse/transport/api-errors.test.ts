/**
 * What a refused request is answered with: the two shapes, and the line between them.
 *
 * A caller under `/api/` parses a body, so every failure there is JSON; a reader elsewhere was
 * navigating to a page, so every failure there is the error page. `router.test.ts` is at its size
 * bar, so the pair lives here — and the page's own 404 moved with it, because "nothing matched"
 * has two answers and a reader who sees only one of them can simplify the branch back into the
 * defect it was written for.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type ServeConfig } from "../config/config.ts";
import { makeFixture, type Fixture } from "../../../test/helpers/fixtures/file-browse.ts";
import { handleRequest, type ServeContext } from "./router.ts";

let fixture: Fixture | undefined;

afterEach(() => {
	fixture?.remove();
	fixture = undefined;
});

/**
 * A fresh tree and the context that serves it.
 *
 * The fixture comes back with it so a case can drop what it made; the root is already the real
 * path `makeFixture` resolves, which is the form the router compares against.
 */
function served(overrides: Partial<ServeConfig> = {}): { ctx: ServeContext; tree: Fixture } {
	const tree = makeFixture();
	fixture = tree;
	return { ctx: { root: tree.root, base: "", config: { ...DEFAULT_CONFIG, ...overrides } }, tree };
}

describe("a request that matched nothing", () => {
	test("answers a page path with the error page", async () => {
		const { ctx } = served();
		const response = await handleRequest(ctx, "GET", "/nope", {});
		expect(response.status).toBe(404);
		expect(response.headers["Content-Type"]).toContain("text/html");
		expect(String(response.body)).toContain("<!doctype html>");
	});

	test("answers an api path with JSON, not the shell", async () => {
		const { ctx } = served();
		const response = await handleRequest(ctx, "GET", "/api/nope", {});
		expect(response.status).toBe(404);
		expect(response.headers["Content-Type"]).toContain("application/json");
		expect(JSON.parse(String(response.body))).toEqual({ error: "That page does not exist." });
		// The whole point: a caller that asked for JSON never gets the page it cannot parse.
		expect(String(response.body)).not.toContain("<!doctype html>");
	});
});

describe("a request that was refused before routing", () => {
	test("answers a refused method in the asker's shape, with Allow either way", async () => {
		const { ctx } = served();
		const api = await handleRequest(ctx, "POST", "/api/files", {});
		expect(api.status).toBe(405);
		expect(api.headers["Content-Type"]).toContain("application/json");
		expect(api.headers.Allow).toBe("GET, HEAD");
		expect(JSON.parse(String(api.body))).toEqual({ error: "Only GET and HEAD are served." });

		const page = await handleRequest(ctx, "POST", "/a.txt", {});
		expect(page.status).toBe(405);
		expect(page.headers["Content-Type"]).toContain("text/html");
		expect(page.headers.Allow).toBe("GET, HEAD");
	});

	test("answers a refused host in the asker's shape", async () => {
		const { ctx } = served();
		const foreign = { host: "evil.example.com" };
		const api = await handleRequest(ctx, "GET", "/api/tree", foreign);
		expect(api.status).toBe(403);
		expect(api.headers["Content-Type"]).toContain("application/json");
		expect(JSON.parse(String(api.body))).toEqual({ error: "Unexpected Host header." });

		const page = await handleRequest(ctx, "GET", "/a.txt", foreign);
		expect(page.status).toBe(403);
		expect(page.headers["Content-Type"]).toContain("text/html");
	});

	test("answers an unknown diff mode with the page, since no api route reaches the check", async () => {
		// `?mode=` is read after the three `/api/` routes match, so a mode can only be refused on a
		// page path — an exact api route ignores the query it does not read.
		const { ctx } = served();
		const page = await handleRequest(ctx, "GET", "/view/a.txt?mode=nope", {});
		expect(page.status).toBe(400);
		expect(page.headers["Content-Type"]).toContain("text/html");
	});

	test("keeps the method guard first when the target itself will not parse", async () => {
		// The trade: the target is classified from its path when it parses and from its leading run
		// when it does not, so the guards keep the order they had — a bad method is still 405, and a
		// target with no readable path falls to the page shape rather than guessing JSON.
		const { ctx } = served();
		const refused = await handleRequest(ctx, "POST", "http://[::1", {});
		expect(refused.status).toBe(405);
		expect(refused.headers["Content-Type"]).toContain("text/html");

		const malformed = await handleRequest(ctx, "GET", "http://[::1", {});
		expect(malformed.status).toBe(400);
		expect(malformed.headers["Content-Type"]).toContain("text/html");
	});
});
