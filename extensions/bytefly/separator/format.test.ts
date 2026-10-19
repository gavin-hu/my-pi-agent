import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { separatorLine } from "./format.ts";

describe("separatorLine", () => {
	test("renders one line of exactly the requested width", () => {
		for (const target of [0, 1, 5, 8, 9, 20, 40, 100]) {
			const lines = separatorLine({ turn: 3 }, target, fakeTheme);
			expect(lines).toHaveLength(1);
			expect(visibleWidth(lines[0] ?? "")).toBe(Math.max(1, target));
		}
	});

	test("centers the label and names the turn", () => {
		expect(separatorLine({ turn: 3 }, 41, fakeTheme)[0]).toBe("╌".repeat(16) + " turn 3 " + "╌".repeat(17));
	});

	test("degrades to a plain dashed rule when the label does not fit", () => {
		expect(separatorLine({ turn: 12 }, 5, fakeTheme)[0]).toBe("╌".repeat(5));
	});

	test("paints the dashes and the label from their design roles", () => {
		expect(separatorLine({ turn: 2 }, 12, coloringTheme)[0]).toBe(
			"[border]" + "╌".repeat(2) + "[muted] turn 2 " + "[border]" + "╌".repeat(2),
		);
	});

	test("insets the rule symmetrically by Pi's output pad", () => {
		const line = separatorLine({ turn: 3 }, 41, fakeTheme, 2)[0] ?? "";
		expect(line.startsWith("  ")).toBe(true);
		expect(line.slice(2)).toContain("turn 3");
		// Two columns on the left, the rule fills the middle, two remain on the right.
		expect(visibleWidth(line)).toBe(39);
	});

	test("a pad never collapses or overflows a narrow line", () => {
		for (const width of [1, 2, 3, 5, 20]) {
			const line = separatorLine({ turn: 3 }, width, fakeTheme, 8)[0] ?? "";
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(visibleWidth(line)).toBeGreaterThan(0);
		}
	});
});

describe("turn receipt", () => {
	test("adds the duration and the tool count", () => {
		const line = separatorLine({ turn: 4, durationMs: 72_000, tools: 7 }, 80, fakeTheme)[0] ?? "";
		expect(line).toContain("turn 4 · 1m12s · 7 tools");
	});

	test("counts failed tools and singularizes one", () => {
		const line = separatorLine({ turn: 4, tools: 1, failures: 1 }, 80, fakeTheme)[0] ?? "";
		expect(line).toContain("turn 4 · 1 tool · ✕1");
	});

	test("names an aborted run instead of its tool count", () => {
		const line = separatorLine({ turn: 4, tools: 3, failures: 2, aborted: true }, 80, fakeTheme)[0] ?? "";
		expect(line).toContain("turn 4 · 3 tools · aborted");
		expect(line).not.toContain("✕");
	});

	test("keeps a sub-second turn quiet", () => {
		const line = separatorLine({ turn: 4, durationMs: 400, tools: 2 }, 80, fakeTheme)[0] ?? "";
		expect(line).toContain("turn 4 · 2 tools");
		expect(line).not.toContain("400ms");
	});

	test("sheds tools, then duration, then the outcome as the line narrows", () => {
		const data = { turn: 4, durationMs: 72_000, tools: 7, failures: 1 };

		expect(separatorLine(data, 30, fakeTheme)[0]).toContain("turn 4 · 1m12s · ✕1");
		expect(separatorLine(data, 20, fakeTheme)[0]).toContain("turn 4 · ✕1");
		expect(separatorLine(data, 12, fakeTheme)[0]).toContain("turn 4");
	});

	test("colors a failed turn as an error and an aborted turn as a warning", () => {
		expect(separatorLine({ turn: 4, failures: 1 }, 80, coloringTheme)[0]).toContain("[error] turn 4 · ✕1 ");
		expect(separatorLine({ turn: 4, aborted: true }, 80, coloringTheme)[0]).toContain("[warning] turn 4 · aborted ");
	});

	test("fits the requested width with a receipt", () => {
		const data = { turn: 4, durationMs: 72_000, tools: 7, failures: 1, aborted: false };
		for (const target of [1, 5, 8, 12, 20, 30, 40, 100]) {
			const lines = separatorLine(data, target, fakeTheme);
			expect(lines).toHaveLength(1);
			expect(visibleWidth(lines[0] ?? "")).toBe(Math.max(1, target));
		}
	});
});
