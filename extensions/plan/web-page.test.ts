import { describe, expect, test } from "bun:test";
import { renderReviewPage, type ReviewPageData } from "./web-page.ts";

function page(overrides: Partial<ReviewPageData> = {}): string {
	return renderReviewPage({
		title: "Add rate limiting",
		blocks: [{ start: 0, end: 0, kind: "heading", lines: ["# Add rate limiting"] }],
		annotations: [],
		outline: [{ id: "s-0", line: 0, level: 1, text: "Add rate limiting" }],
		code: {},
		token: "secret-token",
		...overrides,
	});
}

function island(html: string): Record<string, any> {
	const match = /<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/.exec(html);
	expect(match).not.toBeNull();
	return JSON.parse(match![1]);
}

describe("renderReviewPage", () => {
	test("loads the first-party client, the shared theme, and the actions", () => {
		const html = page();
		expect(html).toContain('<script src="/client.js" defer>');
		expect(html).toContain('<script src="/theme.js">');
		expect(html).toContain('id="theme-toggle"');
		expect(html).toContain('class="theme-glyph"');
		expect(html).toContain('id="save"');
		expect(html).toContain('id="cancel"');
	});

	test("groups the header into identity, status, and controls", () => {
		const html = page();
		expect(html).toContain('class="bf-toolbar review-bar"');
		expect(html).toContain('class="review-heading"');
		expect(html).toContain('class="review-title" id="plan-title"');
		expect(html).not.toContain('id="plan-path"');
		expect(html).toContain('class="bf-status review-status" id="status"');
		expect(html).toContain('class="review-controls"');
	});

	test("keeps the save status inline in the header, not a full-width band", () => {
		const html = page();
		expect(html).toContain('class="bf-status review-status" id="status"');
		expect(html).toContain(".review-status:empty");
		expect(html).not.toContain('<div class="bf-status"');
	});

	test("renders an always-visible session status chip beside the title", () => {
		const html = page();
		expect(html).toContain('class="bf-chip bf-chip--accent review-state" id="review-state"');
		expect(html).toContain("Connecting&#8230;");
		expect(html).toContain(".review-state{flex:0 0 auto");
	});

	test("frames the plan with a section outline and the plan body", () => {
		const html = page();
		expect(html).toContain('id="outline-list"');
		expect(html).toContain("bf-review");
		expect(html).not.toContain('id="steps"');
		expect(html).toContain('href="#plan"');
	});

	test("labels the outline and styles inline comment threads", () => {
		const html = page();
		expect(html).toContain('class="review-nav__title" id="outline-title"');
		expect(html).toContain('aria-labelledby="outline-title"');
		expect(html).toContain(".bf-comments");
		expect(html).toContain(".review-nav__count");
		expect(html).not.toContain("bf-rail");
	});

	test("frames the document with a reading measure and a comment rail", () => {
		const html = page();
		expect(html).toContain("--review-measure:1012px");
		expect(html).toContain(".bf-block__rail");
		expect(html).toContain(".bf-block__count");
		expect(html).toContain(".review-table");
	});

	test("pins a reading-progress bar to the header", () => {
		const html = page();
		expect(html).toContain('class="review-progress"');
		expect(html).toContain('id="progress-fill"');
	});

	test("shows the review facts and the keyboard sheet", () => {
		const html = page();
		expect(html).toContain('id="review-facts"');
		expect(html).toContain('id="step-count"');
		expect(html).toContain("bf-progress__fill");
		expect(html).toContain('id="keys-dialog"');
		expect(html).toContain('id="shortcuts"');
		expect(html).toContain("review-kbd");
	});

	test("drops the outline column when the plan has no headings", () => {
		const html = page({ outline: [] });
		expect(html).toContain("bf-app__body--single");
		expect(html).not.toContain('id="outline-list"');
	});

	test("carries the review data in a JSON island", () => {
		const data = island(page({ code: { "2": ['<span class="tok-keyword">const</span>'] } }));
		expect(data.title).toBe("Add rate limiting");
		expect(data.token).toBe("secret-token");
		expect(data.steps).toBeUndefined();
		expect(data.relativePath).toBeUndefined();
		expect(data.outline[0]).toEqual({ id: "s-0", line: 0, level: 1, text: "Add rate limiting" });
		expect(data.code["2"][0]).toContain("tok-keyword");
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
