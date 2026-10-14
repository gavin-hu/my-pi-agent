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
		expect(REVIEW_CLIENT_JS).toContain('closest(".block")');
	});

	test("keeps a stream open so the server sees the tab close", () => {
		expect(REVIEW_CLIENT_JS).toContain("new EventSource(");
		expect(REVIEW_CLIENT_JS).toContain("sendBeacon");
		expect(REVIEW_CLIENT_JS).toContain("beforeunload");
	});

	test("wires the save and cancel buttons", () => {
		expect(REVIEW_CLIENT_JS).toContain('getElementById("save")');
		expect(REVIEW_CLIENT_JS).toContain('getElementById("cancel")');
		expect(REVIEW_CLIENT_JS).toContain("/api/feedback");
	});
});
