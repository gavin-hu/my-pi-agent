/**
 * The bar's mode slot: which chip it draws, in which role, and the one it draws
 * instead when two mode keys are published.
 *
 * Split from `footer.test.ts` at the suite bar: these cases are the mode surface
 * `lib/tui/glyphs.ts` and `render/segments.ts` share, not the bar's layout.
 */

import { describe, expect, test } from "bun:test";
import { GLYPHS, STATUS_KEYS } from "../../../lib/tui/glyphs.ts";
import { fakeTheme, makeRecordingTheme } from "../../../test/helpers/fakes.ts";
import { fullSnapshot } from "../../../test/helpers/fixtures/footer.ts";
import { modeSegment, modesSegment } from "./render/segments.ts";

describe("the bar's mode slot", () => {
	test("names auto in accent when no mode chip is published", () => {
		const theme = makeRecordingTheme() as any;
		expect(modeSegment(fullSnapshot({ statuses: new Map() }), fakeTheme)?.forms).toEqual([`${GLYPHS.autoMode} auto`]);

		modeSegment(fullSnapshot({ statuses: new Map() }), theme);
		expect(theme.calls).toContainEqual(["accent", `${GLYPHS.autoMode} auto`]);
	});

	test("draws the lead mode in accent, and never beside the plan chip", () => {
		const seat = fullSnapshot({ statuses: new Map([[STATUS_KEYS.leadMode, "lead"]]) });
		expect(modeSegment(seat, fakeTheme)?.forms).toEqual([`${GLYPHS.lead} lead`, GLYPHS.lead]);
		const theme = makeRecordingTheme() as any;
		modeSegment(seat, theme);
		expect(theme.calls).toContainEqual(["accent", `${GLYPHS.lead} lead`]);

		// Plan's guarantee is the stronger one, so a bar carrying both reads plan.
		const both = fullSnapshot({
			statuses: new Map([
				[STATUS_KEYS.leadMode, "lead"],
				[STATUS_KEYS.planMode, "plan"],
			]),
		});
		expect(modeSegment(both, fakeTheme)?.forms?.[0]).toBe(`${GLYPHS.plan} plan`);
	});

	test("never repeats a mode chip in the statuses segment", () => {
		expect(modesSegment(fullSnapshot({ statuses: new Map([[STATUS_KEYS.leadMode, "lead"]]) }), fakeTheme)).toBeNull();
	});
});
