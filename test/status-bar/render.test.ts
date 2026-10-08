import { describe, expect, test } from "bun:test";
import { renderLine } from "../../extensions/status-bar/layout.ts";
import { buildLines } from "../../extensions/status-bar/lines.ts";
import { fakeTheme, fullSnapshot } from "./helpers.ts";

/**
 * Golden rendering of the full bar at fixed widths.
 *
 * The width-sweep tests in `layout.test.ts` only assert that the line fits and
 * contains (or omits) substrings, so a lost separator or a shifted right zone
 * can slip through. These exact strings pin the whole visual result.
 */
const GOLDEN: Array<{ width: number; lines: [string, string] }> = [
	{
		width: 100,
		lines: [
			"~/repo/project                                                                      ⎇ main · ⧉ smoke",
			"▰▰▰▰▰▰▱▱▱▱ 62%/200k · $0.31 · ↑42k ↓8.0k · R96k CH 87% │ ≡ plan                      opus-4.5 · high",
		],
	},
	{
		width: 80,
		lines: [
			"~/repo/project                                                  ⎇ main · ⧉ smoke",
			"▰▰▰▰▰▰▱▱▱▱ 62%/200k · $0.31 · ↑42k ↓8.0k · R96k CH 87% │ ≡ plan  opus-4.5 · high",
		],
	},
	{
		width: 60,
		lines: [
			"~/repo/project                              ⎇ main · ⧉ smoke",
			"▰▰▰▰▰▰▱▱▱▱ 62%/200k · $0.31 │ ≡ plan         opus-4.5 · high",
		],
	},
	{ width: 40, lines: ["~/repo/project          ⎇ main · ⧉ smoke", "▰▰▰▰▰▰▱▱▱▱ 62% · $0.3 │ ≡ plan  opus-4.5"] },
	{ width: 24, lines: ["~/repo/project    ⎇ main", "▰▰▰▱▱ 62% │ ≡   opus-4.5"] },
	{ width: 16, lines: ["project   ⎇ main", "62% ≡   opus-4.5"] },
];

describe("status bar golden render", () => {
	for (const { width, lines } of GOLDEN) {
		test(`renders the full bar at width ${width}`, () => {
			const rendered = buildLines(fullSnapshot(), fakeTheme, "/home/u").map((line) =>
				renderLine(line, width, fakeTheme),
			);
			expect(rendered).toEqual(lines);
		});
	}
});
