import { afterEach, describe, expect, test } from "bun:test";
import { CLIENT_JS } from "./client.ts";
import { LIVE_CLIENT_JS } from "./live-client.ts";
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

	test("folds the whole tree from one control and reveals filtered matches", () => {
		expect(CLIENT_JS).toContain("function paint");
		expect(CLIENT_JS).toContain("function setAll");
		expect(CLIENT_JS).toContain("fold-all");
		expect(CLIENT_JS).toContain('event.key === "-"');
		// A query opens every list, so a fold cannot hide a match, and clearing it
		// restores the tree's own state.
		expect(CLIENT_JS).toContain('query !== "" || li.dataset.open === "true"');
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

	test("opens the keyboard sheet and drives the per-page keys", () => {
		expect(CLIENT_JS).toContain("keys-dialog");
		expect(CLIENT_JS).toContain("window.bfKeys");
		expect(CLIENT_JS).toContain("function toggleRaw");
		expect(CLIENT_JS).toContain("data-hunk");
		expect(CLIENT_JS).toContain("function moveHunk");
		expect(CLIENT_JS).toContain("hunkAnchors");
	});

	test("tracks reading progress for the page's primary scroller", () => {
		expect(CLIENT_JS).toContain("progress-fill");
		expect(CLIENT_JS).toContain("function primaryScroller");
		expect(CLIENT_JS).toContain("function updateProgress");
	});

	test("fades a table whose columns are out of view", () => {
		// The right-edge fade is a class the client toggles from the real overflow,
		// so a table that fits is never faded and neither is one scrolled to the end.
		expect(CLIENT_JS).toContain("md-table-frame");
		expect(CLIENT_JS).toContain("md-table-wrap");
		expect(CLIENT_JS).toContain("browse-table-more");
		expect(CLIENT_JS).toContain("scrollWidth - wrap.clientWidth");
		expect(CLIENT_JS).toContain("wrap.scrollLeft");
	});

	test("steps hunks against the code viewport, not the window", () => {
		// The pinned header sticks to the code pane's top, which is below the
		// window top; scrolling the pane (not scrollIntoView) keeps p working.
		expect(CLIENT_JS).toContain("var lineTop = 8;");
		expect(CLIENT_JS).toContain("scroller.scrollTop +=");
		expect(CLIENT_JS).toContain("paddingTop");
	});

	test("ships the live status block from its own module", () => {
		expect(CLIENT_JS).toContain(LIVE_CLIENT_JS);
		expect(() => new Function(CLIENT_JS)).not.toThrow();
		expect(LIVE_CLIENT_JS).toContain('new EventSource("/events")');
		expect(LIVE_CLIENT_JS).toContain('addEventListener("status"');
		expect(LIVE_CLIENT_JS).toContain("paintLiveChanges");
		expect(LIVE_CLIENT_JS).toContain("paintLiveMarks");
		expect(LIVE_CLIENT_JS).toContain("data-interval");
		expect(LIVE_CLIENT_JS).toContain('"browse-change"');
		expect(LIVE_CLIENT_JS).toContain("pagehide");
		expect(LIVE_CLIENT_JS).toContain("function formatSpan");
	});

	test("paints live status without ever building markup", () => {
		// A branch name or a file path from a status frame is text, never HTML.
		expect(LIVE_CLIENT_JS).not.toContain("innerHTML");
		expect(LIVE_CLIENT_JS).not.toContain("insertAdjacentHTML");
		expect(LIVE_CLIENT_JS).not.toContain("outerHTML");
		expect(LIVE_CLIENT_JS).toContain("textContent");
		// It does nothing unless the server rendered the connection chip.
		expect(LIVE_CLIENT_JS).toContain('document.getElementById("live-state")');
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
