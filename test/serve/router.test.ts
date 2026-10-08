import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { DEFAULT_CONFIG, type ServeConfig } from "../../extensions/serve/config.ts";
import { handleRequest, type ServeContext, type ServeResponse } from "../../extensions/serve/router.ts";
import { makeFixture, type Fixture } from "./helpers.ts";

let fixture: Fixture | undefined;

afterEach(() => {
	fixture?.remove();
	fixture = undefined;
});

function context(overrides: Partial<ServeConfig> = {}): ServeContext {
	if (!fixture) fixture = makeFixture();
	return { root: realpathSync(fixture.root), config: { ...DEFAULT_CONFIG, ...overrides } };
}

function text(response: ServeResponse): string {
	return typeof response.body === "string" ? response.body : (response.body ?? Buffer.alloc(0)).toString("utf-8");
}

describe("routing", () => {
	test("serves the root listing", async () => {
		const response = await handleRequest(context(), "GET", "/", {});
		expect(response.status).toBe(200);
		expect(response.headers["Content-Type"]).toContain("text/html");
		expect(text(response)).toContain("read-only");
		expect(text(response)).toContain("a.txt");
	});

	test("serves a nested directory and a file view", async () => {
		const dir = await handleRequest(context(), "GET", "/browse/sub", {});
		expect(dir.status).toBe(200);
		expect(text(dir)).toContain("b.md");

		const file = await handleRequest(context(), "GET", "/view/a.txt", {});
		expect(file.status).toBe(200);
		expect(text(file)).toContain("hello");
	});

	test("serves /app.js, a 204 favicon, and the tree API", async () => {
		const app = await handleRequest(context(), "GET", "/app.js", {});
		expect(app.status).toBe(200);
		expect(app.headers["Content-Type"]).toContain("text/javascript");

		const icon = await handleRequest(context(), "GET", "/favicon.ico", {});
		expect(icon.status).toBe(204);

		const api = await handleRequest(context(), "GET", "/api/tree?path=sub", {});
		expect(api.status).toBe(200);
		const payload = JSON.parse(text(api)) as {
			path: string;
			entries: Array<{ name: string; href: string; iconHref: string }>;
		};
		expect(payload.path).toBe("sub");
		expect(payload.entries[0]).toMatchObject({ name: "b.md", href: "/view/sub/b.md" });
		expect(payload.entries[0].iconHref).toMatch(/^#i-/);
	});

	test("streams raw files with disposition and the hardened CSP", async () => {
		const textFile = await handleRequest(context(), "GET", "/raw/a.txt", {});
		expect(textFile.filePath).toBeDefined();
		expect(textFile.headers["Content-Disposition"]).toContain("attachment");
		expect(textFile.headers["Content-Security-Policy"]).toContain("script-src 'none'");

		const image = await handleRequest(context(), "GET", "/raw/image.png", {});
		expect(image.headers["Content-Type"]).toBe("image/png");
		expect(image.headers["Content-Disposition"]).toContain("inline");
	});
});

describe("guards", () => {
	test("rejects a foreign Host header", async () => {
		const response = await handleRequest(context(), "GET", "/", { host: "evil.example" });
		expect(response.status).toBe(403);
	});

	test("allows 127.0.0.1 and localhost hosts", async () => {
		expect((await handleRequest(context(), "GET", "/", { host: "127.0.0.1:8080" })).status).toBe(200);
		expect((await handleRequest(context(), "GET", "/", { host: "localhost" })).status).toBe(200);
	});

	test("rejects non-GET/HEAD methods", async () => {
		const response = await handleRequest(context(), "POST", "/", {});
		expect(response.status).toBe(405);
		expect(response.headers.Allow).toBe("GET, HEAD");
	});

	test("blocks encoded traversal and symlink escapes", async () => {
		// The URL parser normalizes %2e%2e, so this never leaves the route prefix.
		const normalized = await handleRequest(context(), "GET", "/view/%2e%2e/outside/secret.txt", {});
		expect(normalized.status).toBe(404);

		const ctx = context();
		if (fixture?.hasSymlinks) {
			const escape = await handleRequest(ctx, "GET", "/view/escape.txt", {});
			expect(escape.status).toBe(403);
		}
	});

	test("returns 404 for unknown routes", async () => {
		expect((await handleRequest(context(), "GET", "/nope", {})).status).toBe(404);
	});
});
