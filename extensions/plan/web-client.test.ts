import { describe, expect, test } from "bun:test";
import { REVIEW_CLIENT_JS } from "./web-client.ts";

describe("REVIEW_CLIENT_JS", () => {
	test("parses as JavaScript", () => {
		expect(() => new Function(REVIEW_CLIENT_JS)).not.toThrow();
	});

	test("has no external URLs", () => {
		expect(REVIEW_CLIENT_JS).not.toContain("http://");
		expect(REVIEW_CLIENT_JS).not.toContain("https://");
		expect(REVIEW_CLIENT_JS).not.toContain("//cdn");
	});

	test("uses only same-origin routes with the session token", () => {
		expect(REVIEW_CLIENT_JS).toContain("/api/feedback?token=");
		expect(REVIEW_CLIENT_JS).toContain("/api/cancel?token=");
		expect(REVIEW_CLIENT_JS).toContain("/events?token=");
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
		expect(REVIEW_CLIENT_JS).toContain("sendBeacon");
		expect(REVIEW_CLIENT_JS).toContain("beforeunload");
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

	test("rejects a protocol-relative link", () => {
		expect(REVIEW_CLIENT_JS).toContain("[\\\\/]{2}");
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
		expect(REVIEW_CLIENT_JS).toContain('"bf-block__add-label"');
		expect(REVIEW_CLIENT_JS).not.toContain("bf-rail");
		expect(REVIEW_CLIENT_JS).toContain('getElementById("outline-list")');
		expect(REVIEW_CLIENT_JS).toContain("IntersectionObserver");
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
});
