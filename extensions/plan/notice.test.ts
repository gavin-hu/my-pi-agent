/**
 * The two toggle notices: one line each, and the read-only guarantee not among them.
 *
 * A text contract rather than a command behaviour, so it sits beside `commands.ts` where
 * the notices are written rather than inside `commands.test.ts`, which is at its size bar.
 * The exact sentence is pinned, and its shape with it — one line, no `READ_ONLY_SUMMARY`
 * — because `docs/extensions/plan.md` and `CHANGELOG.md` quote the words, and the notice
 * this replaced had grown to four wrapped lines.
 */

import { describe, expect, test } from "bun:test";
import { READ_ONLY_SUMMARY } from "../../lib/plan-entry.ts";
import { planModeNotice } from "./commands.ts";

describe("plan-mode notice", () => {
	test("says the mode in one line, not the read-only guarantee", () => {
		const notice = planModeNotice(true);

		expect(notice).toBe("Plan mode enabled — read-only until you approve or leave.");
		// The mode is already on the composer border and the footer chip, and the
		// guarantee is the `enter` consent question's, so the shape is one line.
		expect(notice.length).toBeLessThanOrEqual(80);
		expect(notice).not.toContain(READ_ONLY_SUMMARY);
	});

	test("pairs it with the one-line leaving notice", () => {
		expect(planModeNotice(false)).toBe("Plan mode disabled — full access restored.");
	});
});
