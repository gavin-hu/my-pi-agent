/**
 * The island a review page is built from: the outline it lists, and the heading that names the
 * page.
 *
 * These cases read the builder, not a fixture: `reviewPageData` decides which rows a reader gets,
 * so a page test handed an island of its own choosing cannot see a row the builder should not
 * have made. The split keeps that subject in its own suite rather than growing `web-page`'s.
 */

import { describe, expect, test } from "bun:test";
import { renderReviewPage } from "./web-page.ts";
import { reviewPageData } from "./web-payload.ts";

/** The page one plan's content builds, as the router builds it for an owner. */
function built(content: string) {
	const data = reviewPageData({
		base: "",
		path: "~/.pi/agent/plans/probe/plan.md",
		content,
		caller: { role: "owner" },
		token: "tok",
		canApprove: true,
		share: () => undefined,
	});
	return { data, html: renderReviewPage(data) };
}

describe("the outline a built page is framed with", () => {
	test("lists the plan's sections and not the heading that names the page", () => {
		const { data } = built("# Title\n\n## Goal\n\nBody\n\n## Steps\n- [ ] one\n");
		expect(data.title).toBe("Title");
		expect(data.outline.map((item) => item.text)).toEqual(["Goal", "Steps"]);
	});

	test("keeps a first-level heading that is a section of its own", () => {
		// The rule is the title's own mark, not its level, so a plan written in parts keeps them.
		const { data } = built("# Title\n\n# Part\n\n## Goal\n\nBody\n");
		expect(data.outline.map((item) => item.text)).toEqual(["Part", "Goal"]);
	});

	test("leaves a plan that is only its title without a rail to draw", () => {
		const { data, html } = built("# Title\n\nProse only.\n");
		expect(data.outline).toEqual([]);
		expect(html).toContain("bf-app__body--single");
		expect(html).not.toContain('id="outline-list"');
	});
});
