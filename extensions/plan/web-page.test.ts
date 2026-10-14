import { describe, expect, test } from "bun:test";
import { renderReviewPage, type ReviewPageData } from "./web-page.ts";

function page(overrides: Partial<ReviewPageData> = {}): string {
	return renderReviewPage({
		title: "Add rate limiting",
		relativePath: ".pi/plans/plan.md",
		blocks: [{ start: 0, end: 0, kind: "heading", lines: ["# Add rate limiting"] }],
		annotations: [],
		steps: { done: 1, total: 3 },
		token: "secret-token",
		...overrides,
	});
}

describe("renderReviewPage", () => {
	test("loads the first-party client and offers save and cancel", () => {
		const html = page();
		expect(html).toContain('<script src="/client.js" defer>');
		expect(html).toContain('id="save"');
		expect(html).toContain('id="cancel"');
	});

	test("carries the review data in a JSON island", () => {
		const html = page();
		const match = /<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/.exec(html);
		expect(match).not.toBeNull();
		const data = JSON.parse(match![1]);
		expect(data.title).toBe("Add rate limiting");
		expect(data.token).toBe("secret-token");
		expect(data.steps).toEqual({ done: 1, total: 3 });
	});

	test("escapes a plan line that contains a closing script tag", () => {
		const html = page({
			blocks: [{ start: 0, end: 0, kind: "paragraph", lines: ["</script><script>alert(1)</script>"] }],
		});
		expect(html).not.toContain("</script><script>alert(1)");
		expect(html).toContain("\\u003c/script>");
	});

	test("does not inline plan text outside the island", () => {
		const html = page({
			blocks: [{ start: 0, end: 0, kind: "paragraph", lines: ["UNIQUE_PLAN_TEXT"] }],
		});
		const body = html.slice(0, html.indexOf('<script type="application/json"'));
		expect(body).not.toContain("UNIQUE_PLAN_TEXT");
	});
});
