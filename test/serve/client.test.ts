import { afterEach, describe, expect, test } from "bun:test";
import { CLIENT_JS } from "../../extensions/serve/client.ts";
import { DEFAULT_CONFIG } from "../../extensions/serve/config.ts";
import { handleRequest } from "../../extensions/serve/router.ts";
import { makeFixture, type Fixture } from "./helpers.ts";

let fixture: Fixture | undefined;

afterEach(() => {
	fixture?.remove();
	fixture = undefined;
});

describe("CLIENT_JS", () => {
	test("has no external URLs", () => {
		// The SVG namespace is the only `http://` allowed.
		expect(CLIENT_JS.replaceAll("http://www.w3.org/2000/svg", "")).not.toContain("http");
		expect(CLIENT_JS).not.toContain("//cdn");
	});

	test("uses only same-origin routes", () => {
		expect(CLIENT_JS).toContain("/api/tree?path=");
	});

	test("keeps tree controls accessible and filters in one pass", () => {
		expect(CLIENT_JS).toContain('setAttribute("aria-expanded"');
		expect(CLIENT_JS).toContain('entry.name + "/"');
		expect(CLIENT_JS).toContain("tree-empty");
		expect(CLIENT_JS).toContain("function filterNode");
	});

	test("is served as a no-store script", async () => {
		fixture = makeFixture();
		const response = await handleRequest({ root: fixture.root, config: DEFAULT_CONFIG }, "GET", "/app.js", {});
		expect(response.status).toBe(200);
		expect(response.headers["Content-Type"]).toContain("text/javascript");
		expect(response.headers["Cache-Control"]).toBe("no-store");
		expect(response.body).toBe(CLIENT_JS);
	});
});
