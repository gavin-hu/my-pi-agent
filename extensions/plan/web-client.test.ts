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

	test("keeps a stream open so the server sees the tab close", () => {
		expect(REVIEW_CLIENT_JS).toContain("new EventSource(");
		expect(REVIEW_CLIENT_JS).toContain("sendBeacon");
		expect(REVIEW_CLIENT_JS).toContain("beforeunload");
	});

	test("wires the save and cancel buttons", () => {
		expect(REVIEW_CLIENT_JS).toContain('getElementById("save")');
		expect(REVIEW_CLIENT_JS).toContain('getElementById("cancel")');
		expect(REVIEW_CLIENT_JS).toContain('getElementById("status")');
		expect(REVIEW_CLIENT_JS).toContain("/api/feedback");
	});

	test("keeps the header comment count compact", () => {
		expect(REVIEW_CLIENT_JS).toContain('"No comments"');
		expect(REVIEW_CLIENT_JS).toContain("commentCount.title");
	});

	test("builds the right-hand rail and the section outline", () => {
		expect(REVIEW_CLIENT_JS).toContain('"bf-rail__cell"');
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
