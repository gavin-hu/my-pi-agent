import { describe, expect, test } from "bun:test";
import { REVIEW_CLIENT_JS } from "./web-client.ts";

const REVIEW_ORIGIN = "http://127.0.0.1:1234/?token=t";

/**
 * The `safeHref` the page actually ships, evaluated out of the client source: a
 * string assertion cannot tell a fixed rule from a broken one.
 */
function shippedSafeHref(): (url: string, base: string) => string | null {
	const start = REVIEW_CLIENT_JS.indexOf("function safeHref(");
	const end = REVIEW_CLIENT_JS.indexOf("\n  }", start);
	const source = start >= 0 && end > start ? REVIEW_CLIENT_JS.slice(start, end + 4) : "";
	return new Function(`${source}\nreturn safeHref;`)() as (url: string, base: string) => string | null;
}

const linkFor = (url: string): string | null => shippedSafeHref()(url, REVIEW_ORIGIN);

describe("REVIEW_CLIENT_JS", () => {
	test("parses as JavaScript", () => {
		expect(() => new Function(REVIEW_CLIENT_JS)).not.toThrow();
	});

	test("has no external URLs beyond the autolink scheme", () => {
		// The Markdown autolinker is the only place a scheme literal appears; the
		// client itself fetches only same-origin routes (asserted below).
		const withoutScheme = REVIEW_CLIENT_JS.replace('"http://" + url', "");
		expect(withoutScheme).not.toContain("http://");
		expect(REVIEW_CLIENT_JS).not.toContain("https://");
		expect(REVIEW_CLIENT_JS).not.toContain("//cdn");
	});

	test("autolinks a bare URL the way GitHub does", () => {
		expect(REVIEW_CLIENT_JS).toContain("GFM extended autolink");
		expect(REVIEW_CLIENT_JS).toContain("(?:https?");
		expect(REVIEW_CLIENT_JS).toContain('"http://" + url');
		expect(REVIEW_CLIENT_JS).toContain("safeHref(target, location.href)");
	});

	test("uses only same-origin routes with the session token", () => {
		expect(REVIEW_CLIENT_JS).toContain('submit("/api/feedback"');
		expect(REVIEW_CLIENT_JS).toContain('submit("/api/approve"');
		expect(REVIEW_CLIENT_JS).toContain("/api/cancel?token=");
		expect(REVIEW_CLIENT_JS).toContain("/events?token=");
		expect(REVIEW_CLIENT_JS).toContain('"?token=" + encodeURIComponent(token)');
	});

	test("approves the plan and settles the page on a terminal state", () => {
		expect(REVIEW_CLIENT_JS).toContain('getElementById("approve")');
		expect(REVIEW_CLIENT_JS).toContain("function approve()");
		expect(REVIEW_CLIENT_JS).toContain('if (event.key === "a" && approveButton)');
		expect(REVIEW_CLIENT_JS).toContain('label = "Approved"');
		expect(REVIEW_CLIENT_JS).toContain('label = "Closed"');
	});

	test("never assigns plan or comment text as markup", () => {
		expect(REVIEW_CLIENT_JS).not.toContain("innerHTML");
		expect(REVIEW_CLIENT_JS).toContain(".textContent =");
	});

	test("captures a selection as a quote", () => {
		expect(REVIEW_CLIENT_JS).toContain("getSelection");
		expect(REVIEW_CLIENT_JS).toContain("commonAncestorContainer");
		expect(REVIEW_CLIENT_JS).toContain('closest(".bf-block")');
	});

	test("remembers a selection for the + Comment button instead of opening on select", () => {
		expect(REVIEW_CLIENT_JS).toContain("pendingQuote");
		expect(REVIEW_CLIENT_JS).toContain("insertAdjacentElement");
	});

	test("keeps a stream open so the server sees the tab close", () => {
		expect(REVIEW_CLIENT_JS).toContain("new EventSource(");
		// A closed tab is a dropped stream the server times out; a beacon would also
		// cancel the review on a reload, which the 409 path offers on purpose.
		expect(REVIEW_CLIENT_JS).not.toContain("sendBeacon");
		expect(REVIEW_CLIENT_JS).not.toContain("beforeunload");
	});

	test("wires the always-visible header status chip", () => {
		expect(REVIEW_CLIENT_JS).toContain('getElementById("review-state")');
		expect(REVIEW_CLIENT_JS).toContain("function updateState()");
		expect(REVIEW_CLIENT_JS).toContain('addEventListener("open"');
		expect(REVIEW_CLIENT_JS).toContain('addEventListener("error"');
		expect(REVIEW_CLIENT_JS).toContain("dirty = true");
		expect(REVIEW_CLIENT_JS).toContain("unsaved");
		expect(REVIEW_CLIENT_JS).toContain("observeSections();\n    updateState();"); // allow:padding assertion
	});

	test("does not show Offline before the stream first connects", () => {
		expect(REVIEW_CLIENT_JS).toContain("var everConnected = false;");
		expect(REVIEW_CLIENT_JS).toContain("} else if (connected === true) {");
		expect(REVIEW_CLIENT_JS).toContain("} else if (everConnected) {");
		expect(REVIEW_CLIENT_JS).toContain("everConnected = true");
	});

	test("rejects a protocol-relative link", () => {
		expect(linkFor("//evil.com")).toBeNull();
	});

	test("refuses a link that is only cross-origin after URL parsing", () => {
		// trim keeps an interior tab, and the URL parser deletes it: without
		// resolving first, "/\t/evil.com" reads as a same-origin path.
		expect(linkFor("/\t/evil.com")).toBeNull();
		expect(linkFor("/\n/x.com")).toBeNull();
	});

	test("refuses a non-web scheme and a credentialed URL", () => {
		for (const target of ["javascript:alert(1)", "data:text/html,x", "https://user:pw@example.com/x"]) {
			expect(linkFor(target)).toBeNull();
		}
	});

	test("keeps web, mail, anchor, and same-origin relative links", () => {
		expect(linkFor("https://example.com/x")).toBe("https://example.com/x");
		expect(linkFor("mailto:a@b.example")).toBe("mailto:a@b.example");
		expect(linkFor("#section")).toBe("http://127.0.0.1:1234/?token=t#section");
		expect(linkFor("docs/x.md")).toBe("http://127.0.0.1:1234/docs/x.md");
	});

	test("offers a reload when the plan changed on disk", () => {
		expect(REVIEW_CLIENT_JS).toContain("response.status === 409");
		expect(REVIEW_CLIENT_JS).toContain("window.location.reload()");
		expect(REVIEW_CLIENT_JS).toContain('"reload"');
	});

	test("clears a remembered selection on re-render", () => {
		expect(REVIEW_CLIENT_JS).toContain("closeComposer();\n    pendingQuote = null;"); // allow:padding assertion
	});

	test("wires the save and cancel buttons", () => {
		expect(REVIEW_CLIENT_JS).toContain('getElementById("save")');
		expect(REVIEW_CLIENT_JS).toContain('getElementById("cancel")');
		expect(REVIEW_CLIENT_JS).toContain('getElementById("status")');
		expect(REVIEW_CLIENT_JS).toContain("/api/feedback");
	});

	test("renders inline comment threads and the section outline", () => {
		expect(REVIEW_CLIENT_JS).toContain('"bf-comments"');
		expect(REVIEW_CLIENT_JS).toContain('"bf-block__add"');
		expect(REVIEW_CLIENT_JS).toContain('"bf-block__count"');
		expect(REVIEW_CLIENT_JS).not.toContain("bf-rail");
		expect(REVIEW_CLIENT_JS).toContain('getElementById("outline-list")');
		expect(REVIEW_CLIENT_JS).toContain("IntersectionObserver");
	});

	test("renders GFM tables and thematic breaks", () => {
		expect(REVIEW_CLIENT_JS).toContain('"review-table"');
		expect(REVIEW_CLIENT_JS).toContain("columnAlign");
		expect(REVIEW_CLIENT_JS).toContain('block.kind === "table"');
		expect(REVIEW_CLIENT_JS).toContain('block.kind === "hr"');
	});

	test("hangs a list continuation under its item", () => {
		// A line without a marker joins the previous item instead of becoming a
		// bare left-margin paragraph, so a hard-wrapped item reads as one block.
		expect(REVIEW_CLIENT_JS).toContain("var items = [];");
		expect(REVIEW_CLIENT_JS).toContain("items[items.length - 1]");
		expect(REVIEW_CLIENT_JS).toContain('last.rest += " " + line.trim()');
		expect(REVIEW_CLIENT_JS).toContain("items.forEach(function (item) { renderInline(item.body, item.rest); });");
	});

	test("navigates blocks and shows the keyboard sheet", () => {
		expect(REVIEW_CLIENT_JS).toContain("function moveActive(delta)");
		expect(REVIEW_CLIENT_JS).toContain("function commentOnActive()");
		expect(REVIEW_CLIENT_JS).toContain('"bf-block--active"');
		expect(REVIEW_CLIENT_JS).toContain('getElementById("keys-dialog")');
	});

	test("tracks the review facts and reading progress", () => {
		expect(REVIEW_CLIENT_JS).toContain("function renderFacts()");
		expect(REVIEW_CLIENT_JS).toContain('"step-fill"');
		// The server computes the step count from the same list approval seeds.
		expect(REVIEW_CLIENT_JS).toContain("data.steps");
		expect(REVIEW_CLIENT_JS).toContain("function updateProgress()");
		expect(REVIEW_CLIENT_JS).toContain('"progress-fill"');
	});

	test("observes the renamed blocks and styles the comment textareas", () => {
		expect(REVIEW_CLIENT_JS).toContain(".bf-block[id]");
		expect(REVIEW_CLIENT_JS).toContain('"bf-textarea"');
	});

	test("copies server-highlighted code through a DOM allowlist", () => {
		expect(REVIEW_CLIENT_JS).toContain("DOMParser");
		expect(REVIEW_CLIENT_JS).toContain("tok-");
		expect(REVIEW_CLIENT_JS).not.toContain("innerHTML");
	});

	test("embeds the shared theme toggle", () => {
		expect(REVIEW_CLIENT_JS).toContain('getElementById("theme-toggle")');
		expect(REVIEW_CLIENT_JS).toContain("prefers-color-scheme: light");
	});

	test("marks a changed outline section with a labelled dot", () => {
		expect(REVIEW_CLIENT_JS).toContain('"review-changed"');
		expect(REVIEW_CLIENT_JS).toContain("Changed since your last review");
		expect(REVIEW_CLIENT_JS).toContain("item.changed");
	});
});
