import { describe, expect, test } from "bun:test";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import { GLYPHS } from "./glyphs.ts";
import { computeGauge, DEFAULT_GAUGE_THRESHOLDS, gaugeBar, gaugeRole } from "./gauge.ts";

describe("computeGauge", () => {
	test("spans the track from empty to full", () => {
		expect(computeGauge(0, 10)).toEqual({ filled: 0, empty: 10 });
		expect(computeGauge(100, 10)).toEqual({ filled: 10, empty: 0 });
		expect(computeGauge(62, 10)).toEqual({ filled: 6, empty: 4 });
	});

	test("floors, so the bar reads full only at 100%", () => {
		expect(computeGauge(99, 10)).toEqual({ filled: 9, empty: 1 });
	});

	test("forces one block for any non-zero usage", () => {
		expect(computeGauge(1, 10)).toEqual({ filled: 1, empty: 9 });
	});

	test("clamps out-of-range percentages", () => {
		expect(computeGauge(140, 10)).toEqual({ filled: 10, empty: 0 });
		expect(computeGauge(-5, 10)).toEqual({ filled: 0, empty: 10 });
	});

	test("an unknown percentage fills nothing", () => {
		expect(computeGauge(null, 8)).toEqual({ filled: 0, empty: 8 });
	});

	test("a zero-width track is empty", () => {
		expect(computeGauge(50, 0)).toEqual({ filled: 0, empty: 0 });
	});
});

describe("gaugeRole", () => {
	test("stays neutral below the warn threshold", () => {
		expect(gaugeRole(null)).toBe("meta");
		expect(gaugeRole(50)).toBe("meta");
		expect(gaugeRole(DEFAULT_GAUGE_THRESHOLDS.warn)).toBe("meta");
	});

	test("warns between the thresholds and errors above the danger one", () => {
		expect(gaugeRole(DEFAULT_GAUGE_THRESHOLDS.warn + 1)).toBe("warn");
		expect(gaugeRole(DEFAULT_GAUGE_THRESHOLDS.danger)).toBe("warn");
		expect(gaugeRole(DEFAULT_GAUGE_THRESHOLDS.danger + 1)).toBe("bad");
	});

	test("honours custom thresholds", () => {
		expect(gaugeRole(50, { warn: 40, danger: 60 })).toBe("warn");
	});
});

describe("gaugeBar", () => {
	test("draws filled and empty blocks", () => {
		expect(gaugeBar(fakeTheme, { percent: 60, blocks: 5 })).toBe(
			GLYPHS.gaugeFull.repeat(3) + GLYPHS.gaugeEmpty.repeat(2),
		);
	});

	test("draws the empty track for a known zero", () => {
		expect(gaugeBar(fakeTheme, { percent: 0, blocks: 4 })).toBe(GLYPHS.gaugeEmpty.repeat(4));
	});

	test("draws nothing when the percentage is unknown", () => {
		expect(gaugeBar(fakeTheme, { percent: null, blocks: 4 })).toBe("");
	});

	test("paints the bar with the derived role", () => {
		expect(gaugeBar(coloringTheme, { percent: 100, blocks: 2 })).toBe(`[error]${GLYPHS.gaugeFull.repeat(2)}`);
	});

	test("paints the empty track with its own role", () => {
		expect(gaugeBar(coloringTheme, { percent: 50, blocks: 2, emptyRole: "faint" })).toBe(
			`[muted]${GLYPHS.gaugeFull}[dim]${GLYPHS.gaugeEmpty}`,
		);
	});
});
