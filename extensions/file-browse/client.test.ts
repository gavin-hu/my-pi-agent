import { afterEach, describe, expect, test } from "bun:test";
import { CLIENT_JS } from "./client.ts";
import { THEME_JS, WEB_THEME_STORAGE_KEY } from "../../lib/web/index.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { handleRequest } from "./router.ts";
import { makeFixture, type Fixture } from "../../test/helpers/fixtures/file-browse.ts";

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

	test("filters by path and reports load state", () => {
		expect(CLIENT_JS).toContain('setAttribute("data-path"');
		expect(CLIENT_JS).toContain("dataset.loading");
		expect(CLIENT_JS).toContain("dataset.error");
		expect(CLIENT_JS).toContain("aria-busy");
		expect(CLIENT_JS).toContain("Could not load");
		expect(CLIENT_JS).toContain("broken symbolic link");
		expect(CLIENT_JS).toContain("response.ok");
	});

	test("collapses the sidebar on narrow viewports", () => {
		expect(CLIENT_JS).toContain("details.bf-app__sidebar");
		expect(CLIENT_JS).toContain("matchMedia");
		expect(CLIENT_JS).toContain("(max-width: 860px)");
	});

	test("sorts listings and remembers the choice", () => {
		expect(CLIENT_JS).toContain("data-sort");
		expect(CLIENT_JS).toContain("aria-sort");
		expect(CLIENT_JS).toContain("browse-sort");
		expect(CLIENT_JS).toContain('getAttribute("data-dir")');
	});

	test("toggles wrapping and copies with a clipboard fallback", () => {
		expect(CLIENT_JS).toContain("browse-wrap");
		expect(CLIENT_JS).toContain("wrap-toggle");
		expect(CLIENT_JS).toContain("[data-copy]");
		expect(CLIENT_JS).toContain("navigator.clipboard");
		expect(CLIENT_JS).toContain("execCommand");
	});

	test("toggles the theme and remembers the choice", () => {
		expect(CLIENT_JS).toContain(WEB_THEME_STORAGE_KEY);
		expect(CLIENT_JS).toContain("theme-toggle");
		expect(CLIENT_JS).toContain("theme-glyph");
		expect(CLIENT_JS).toContain('setAttribute("data-theme"');
		expect(CLIENT_JS).toContain("(prefers-color-scheme: light)");
	});

	test("wires the quick-open palette", () => {
		expect(CLIENT_JS).toContain('"/api/files?q="');
		expect(CLIENT_JS).toContain("bf-dialog__option");
		expect(CLIENT_JS).toContain("aria-activedescendant");
		expect(CLIENT_JS).toContain("quick-open");
		expect(CLIENT_JS).toContain('"role", "dialog"');
		expect(CLIENT_JS).toContain('event.key === "Escape"');
		expect(CLIENT_JS).toContain("metaKey");
	});

	test("is served as a no-store script", async () => {
		fixture = makeFixture();
		const response = await handleRequest({ root: fixture.root, config: DEFAULT_CONFIG }, "GET", "/app.js", {});
		expect(response.status).toBe(200);
		expect(response.headers["Content-Type"]).toContain("text/javascript");
		expect(response.headers["Cache-Control"]).toBe("no-store");
		expect(response.body).toBe(CLIENT_JS);
	});

	test("serves the theme bootstrap before paint", async () => {
		fixture = makeFixture();
		const response = await handleRequest({ root: fixture.root, config: DEFAULT_CONFIG }, "GET", "/theme.js", {});
		expect(response.status).toBe(200);
		expect(response.headers["Content-Type"]).toContain("text/javascript");
		expect(response.body).toBe(THEME_JS);
		expect(THEME_JS).toContain(WEB_THEME_STORAGE_KEY);
		expect(THEME_JS).toContain("data-theme");
	});
});
