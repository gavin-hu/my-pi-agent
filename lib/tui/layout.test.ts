/**
 * Layout: width arithmetic, the docked-list frame, the transcript indent, and
 * the rule grammar. Every helper here is judged by columns and section order,
 * never by literal padding.
 */

import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme, innerOf } from "../../test/helpers/fakes.ts";
import {
	detailBlockRows,
	dockListFrame,
	editorTheme,
	FULL_SCREEN_OVERLAY,
	reuseText,
	screenFooter,
	screenHint,
	toolDetails,
	viewportRows,
} from "./chrome.ts";
import {
	clip,
	clipLabel,
	clipMiddle,
	fitCells,
	flowCells,
	inlineRow,
	LABEL_WIDTH,
	labelLine,
	padTo,
	splitRow,
} from "./columns.ts";
import { BODY_INDENT, bodyLines, indentBlockLines, indentedLines } from "./indent.ts";
import { centeredRule, plainRule, RULE_GLYPH, titleRule } from "./rules.ts";

/** Column counts exercised by the width sweeps. */
const WIDTHS = Array.from({ length: 115 }, (_, index) => index + 6);

/** A representative mix: ASCII, a CJK sample, and a themed string. */
const SAMPLES = ["Extensions", "日本語のリスト", "\u001b[31mred\u001b[39m text", "a", ""];

/** The visible text of a placed line, ignoring its indent. */
function visibleText(line: string | undefined): string {
	return stripTerminalSequences(line ?? "").trim();
}

/** The column a placed line's text starts in. */
function columnOf(line: string | undefined, text: string): number {
	return stripTerminalSequences(line ?? "").indexOf(text);
}

describe("viewportRows", () => {
	const options = { chrome: 7, fallback: 12 };

	test("falls back when the terminal height is unknown", () => {
		expect(viewportRows(undefined, options)).toBe(12);
		expect(viewportRows(0, options)).toBe(12);
	});

	test("fills the terminal, subtracting the chrome", () => {
		expect(viewportRows(60, options)).toBe(53);
		expect(viewportRows(15, options)).toBe(8);
	});

	test("shrinks rather than overflowing on a short terminal", () => {
		expect(viewportRows(8, options)).toBe(1);
		expect(viewportRows(1, options)).toBe(1);
	});

	test("resolves a live getter so a resize is picked up", () => {
		let rows = 30;
		expect(viewportRows(() => rows, options)).toBe(23);
		rows = 15;
		expect(viewportRows(() => rows, options)).toBe(8);
		expect(viewportRows(() => undefined, options)).toBe(12);
	});

	test("gives the one full-screen surface the whole terminal", () => {
		expect(FULL_SCREEN_OVERLAY.overlay).toBe(true);
		expect(FULL_SCREEN_OVERLAY.overlayOptions.width).toBe("100%");
	});
});

describe("screenHint", () => {
	test("joins hints with the item separator under the body indent", () => {
		const line = screenHint(fakeTheme, 80, ["a", "b"]);
		expect(columnOf(line, "a")).toBe(BODY_INDENT);
		expect(line).toContain("a · b");
	});

	test("places the hints at the requested indent", () => {
		const line = screenHint(fakeTheme, 80, ["a", "b"], 3);
		expect(columnOf(line, "a")).toBe(3);
		expect(line).toContain("a · b");
	});

	test("keeps a column for the hint however deep the indent", () => {
		expect(screenHint(fakeTheme, 1, ["a"], 4)).toBe("a");
	});

	test("clips to the width at a custom indent", () => {
		const line = screenHint(fakeTheme, 10, ["alpha", "beta", "gamma"], 4);
		expect(columnOf(line, "alpha")).toBe(4);
		expect(line).not.toContain("beta");
		expect(visibleWidth(line)).toBeLessThanOrEqual(10);
	});

	test("drops a whole hint rather than truncating it, keeping the first", () => {
		const line = screenHint(fakeTheme, 10, ["alpha", "beta", "gamma"]);
		expect(line).toContain("alpha");
		expect(line).not.toContain("beta");
		expect(visibleWidth(line)).toBeLessThanOrEqual(10);
	});

	test("still returns the first hint when it alone overflows", () => {
		const line = screenHint(fakeTheme, 4, ["alpha", "beta"]);
		expect(visibleWidth(line)).toBeLessThanOrEqual(4);
	});

	test("colors a primary hint while plain hints stay dim", () => {
		const line = screenHint(coloringTheme, 80, ["Esc close", { text: "a approve", color: "ok" }]);
		expect(line).toContain("[dim]Esc close");
		expect(line).toContain("[success]a approve");
	});
});

describe("dockListFrame", () => {
	const frame = { theme: fakeTheme, width: 80 };
	const rule = plainRule(fakeTheme, 80);

	test("assembles the header, summary, body, and hint with the shared blanks", () => {
		const lines = dockListFrame({ ...frame, header: "Jobs", summary: "1 job", body: ["a", "b"], hint: "Esc close" });
		expect(lines).toEqual(["Jobs", "1 job", "", "a", "b", "", "Esc close", rule]);
	});

	test("omits the summary and its blank line when absent", () => {
		const lines = dockListFrame({ ...frame, header: "Jobs", body: ["a"], hint: "Esc" });
		expect(lines).toEqual(["Jobs", "a", "", "Esc", rule]);
	});

	test("places the range after the body and the detail after the range", () => {
		const lines = dockListFrame({
			...frame,
			header: "Jobs",
			body: ["a"],
			range: "1/2",
			detail: ["detail"],
			hint: "Esc",
		});
		expect(lines).toEqual(["Jobs", "a", "1/2", "", "detail", "", "Esc", rule]);
	});

	test("adds no blank line for an empty detail block", () => {
		const lines = dockListFrame({ ...frame, header: "Jobs", body: ["a"], detail: [], hint: "Esc" });
		expect(lines).toEqual(["Jobs", "a", "", "Esc", rule]);
	});

	test("drops the separator rather than the block when the caller asks", () => {
		const lines = dockListFrame({
			...frame,
			header: "Jobs",
			body: ["a"],
			detail: ["detail"],
			detailBlank: false,
			hint: "Esc",
		});
		expect(lines).toEqual(["Jobs", "a", "detail", "", "Esc", rule]);
	});

	test("closes with the muted rule, as Pi's built-in screens do", () => {
		const lines = dockListFrame({ theme: coloringTheme, width: 4, header: "Jobs", body: ["a"], hint: "Esc" });
		expect(lines.at(-1)).toBe("[borderMuted]────");
	});

	test("keeps the caller's header and the hint inside the width", () => {
		for (const width of [1, 8, 20, 80]) {
			const lines = dockListFrame({
				theme: fakeTheme,
				width,
				header: titleRule(fakeTheme, width, "Extensions"),
				body: [],
				hint: screenHint(fakeTheme, width, ["Esc close"]),
			});

			expect(visibleWidth(lines[0] ?? "")).toBe(Math.max(1, width));
			expect(visibleWidth(lines.at(-2) ?? "")).toBeLessThanOrEqual(width);
			expect(visibleWidth(lines.at(-1) ?? "")).toBe(Math.max(1, width));
		}
	});
});

describe("screenFooter", () => {
	test("is a blank row, the hint row, and the closing rule", () => {
		expect(screenFooter(fakeTheme, 8, "Esc close")).toEqual(["", "Esc close", "─".repeat(8)]);
	});

	test("paints the rule with the rule role", () => {
		expect(screenFooter(coloringTheme, 3, "Esc")).toEqual(["", "Esc", "[borderMuted]───"]);
	});

	test("never renders a rule of zero columns", () => {
		for (const width of [0, -5]) {
			expect(visibleWidth(screenFooter(fakeTheme, width, "Esc").at(-1) ?? "")).toBe(1);
		}
	});
});

describe("detailBlockRows", () => {
	test("counts the block's lines plus the blank line above them", () => {
		expect(detailBlockRows(undefined)).toBe(0);
		expect(detailBlockRows([])).toBe(0);
		expect(detailBlockRows(["a"])).toBe(2);
		expect(detailBlockRows(["a", "b"])).toBe(3);
	});

	test("drops the blank from the count when the caller drops the separator", () => {
		expect(detailBlockRows(["a"], false)).toBe(1);
	});
});

describe("reuseText", () => {
	test("reuses a Text component and allocates for anything else", () => {
		const first = reuseText(undefined, "a");
		expect(reuseText(first, "b")).toBe(first);
		expect(reuseText({ render: () => [] }, "b")).not.toBe(first);
	});
});

describe("toolDetails", () => {
	test("reads non-empty details and rejects Pi's empty rejection envelope", () => {
		expect(toolDetails({ status: "ok" })).toEqual({ status: "ok" });
		expect(toolDetails({})).toBeUndefined();
		expect(toolDetails(null)).toBeUndefined();
		expect(toolDetails("details")).toBeUndefined();
	});
});

describe("editorTheme", () => {
	test("routes the editor chrome through semantic roles", () => {
		const theme = editorTheme(coloringTheme);
		expect(theme.borderColor("x")).toBe("[borderMuted]x");
		expect(theme.selectList?.selectedText("x")).toBe("[accent]x");
		expect(theme.selectList?.description("x")).toBe("[muted]x");
		expect(theme.selectList?.noMatch("x")).toBe("[warning]x");
	});
});

describe("clip", () => {
	test("keeps text that fits and marks a cut with an ellipsis", () => {
		expect(clip("Extensions", 10)).toBe("Extensions");
		expect(stripTerminalSequences(clip("Extensions", 6))).toBe("Exten…");
	});

	test("never exceeds the width, even for wide and themed characters", () => {
		for (const width of WIDTHS) {
			for (const sample of SAMPLES) {
				expect(visibleWidth(clip(sample, width))).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("clipMiddle", () => {
	test("keeps text that fits untouched", () => {
		expect(clipMiddle("example.com/retry", 40)).toBe("example.com/retry");
	});

	test("keeps the head and the tail of a long path", () => {
		const out = stripTerminalSequences(clipMiddle("https://example.com/docs/guides/retry-policy", 24));
		expect(out.startsWith("https://")).toBe(true);
		expect(out.endsWith("policy")).toBe(true);
		expect(out).toContain("…");
	});

	test("never exceeds the width, even for wide and themed characters", () => {
		for (const width of WIDTHS) {
			for (const sample of SAMPLES) {
				expect(visibleWidth(clipMiddle(sample, width))).toBeLessThanOrEqual(width);
			}
		}
	});

	test("keeps a themed string coloured on both halves", () => {
		const red = "\u001b[31m";
		const reset = "\u001b[39m";
		const out = clipMiddle(`${red}https://example.com/docs/retry-policy${reset}`, 24);
		expect(out.split(red).length - 1).toBeGreaterThanOrEqual(2);
		expect(visibleWidth(out)).toBeLessThanOrEqual(24);
	});

	test("degrades to a plain clip when there is no room for both ends", () => {
		expect(stripTerminalSequences(clipMiddle("example.com/retry", 1))).toBe("…");
		expect(visibleWidth(clipMiddle("example.com/retry", 2))).toBeLessThanOrEqual(2);
	});
});

describe("padTo", () => {
	test("pads to the exact width and leaves longer text untouched", () => {
		expect(visibleWidth(padTo("ab", 10))).toBe(10);
		expect(padTo("ab", 10).startsWith("ab")).toBe(true);
		expect(visibleWidth(padTo("abcdefghijkl", 4))).toBeGreaterThan(4);
	});

	test("treats a wide glyph as two columns", () => {
		expect(visibleWidth(padTo("日本", 6))).toBe(6);
	});
});

describe("labelLine", () => {
	test("collapses to one line and clips at the label width", () => {
		expect(labelLine("a\nb\tc")).toBe("a b c");
		expect(labelLine("a\u0007b")).toBe("a b");
		expect(visibleWidth(labelLine("x".repeat(LABEL_WIDTH + 20)))).toBe(LABEL_WIDTH);
	});

	test("uses the sanitizer it is given", () => {
		expect(labelLine("a\u0007b", () => "kept")).toBe("kept");
	});
});

describe("clipLabel", () => {
	test("strips escapes and collapses control characters", () => {
		expect(clipLabel("a\u001b[31mb\u0007c")).toBe("ab c");
	});

	test("clips to the label width", () => {
		expect(visibleWidth(clipLabel("x".repeat(LABEL_WIDTH + 20)))).toBe(LABEL_WIDTH);
	});
});

describe("splitRow", () => {
	test("pushes the right cell to the edge with a gap before it", () => {
		const line = splitRow("ab", "yz", 10);
		expect(line.startsWith("ab")).toBe(true);
		expect(line.endsWith("yz")).toBe(true);
		expect(columnOf(line, "yz")).toBe(8);
		expect(visibleWidth(line)).toBe(10);
	});

	test("clips the left cell before the right anchor", () => {
		const line = splitRow("a-very-long-left-cell", "right", 12);
		expect(line.endsWith("right")).toBe(true);
		expect(visibleWidth(line)).toBe(12);
	});

	test("keeps the right anchor when only it fits", () => {
		expect(stripTerminalSequences(splitRow("left", "a-long-right-anchor", 8))).toBe("a-long-…");
	});

	test("an empty right cell means no trailing padding", () => {
		expect(splitRow("left", "", 10)).toBe("left");
		expect(visibleWidth(splitRow("left", "", 10))).toBe(4);
	});

	test("every result fits the width", () => {
		for (const width of WIDTHS) {
			for (const sample of SAMPLES) {
				expect(visibleWidth(splitRow(sample, "yz", width))).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("inlineRow", () => {
	test("keeps the two cells together with the gap between", () => {
		const line = inlineRow("ab", "yz", 10);
		expect(line.startsWith("ab")).toBe(true);
		expect(line.endsWith("yz")).toBe(true);
		expect(columnOf(line, "yz")).toBe(4);
	});

	test("clips the left cell before the right cell loses anything", () => {
		const line = inlineRow("a-very-long-left-cell", "right", 12);
		expect(stripTerminalSequences(line).endsWith("right")).toBe(true);
		expect(stripTerminalSequences(line)).toContain("…");
		expect(visibleWidth(line)).toBeLessThanOrEqual(12);
	});

	test("keeps the value when only it fits", () => {
		expect(stripTerminalSequences(inlineRow("label", "value", 4))).toBe("val…");
		expect(stripTerminalSequences(inlineRow("label", "yz", 2))).toBe("yz");
	});

	test("an empty right cell means no gap and no padding", () => {
		expect(inlineRow("left", "", 10)).toBe("left");
	});

	test("does not pad the line to the width", () => {
		const line = inlineRow("ab", "yz", 40);
		expect(line).toBe("ab  yz");
		expect(visibleWidth(line)).toBeLessThan(40);
	});

	test("every result fits the width", () => {
		for (const width of WIDTHS) {
			for (const sample of SAMPLES) {
				expect(visibleWidth(inlineRow(sample, "yz", width))).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("flowCells", () => {
	test("packs whole cells greedily and wraps at the width", () => {
		expect(flowCells(["a", "b", "c"], 2)).toEqual(["ab", "c"]);
	});

	test("keeps every cell when they all fit", () => {
		expect(flowCells(["a", "b", "c"], 10)).toEqual(["abc"]);
	});

	test("clips an over-wide cell instead of splitting it", () => {
		const lines = flowCells(["wide-cell"], 4);
		expect(lines).toHaveLength(1);
		expect(visibleWidth(lines[0] ?? "")).toBeLessThanOrEqual(4);
	});

	test("always returns at least one line", () => {
		expect(flowCells([], 10)).toEqual([""]);
	});

	test("every line fits the width", () => {
		const cells = [" alpha ", " beta ", " gamma ", " delta "];
		for (const width of WIDTHS) {
			for (const line of flowCells(cells, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("fitCells", () => {
	test("drops trailing cells whole instead of clipping one", () => {
		expect(fitCells(["alpha", "beta", "gamma"], 11)).toBe("alpha beta");
	});

	test("keeps the first cell even when it alone overflows", () => {
		expect(stripTerminalSequences(fitCells(["a-very-long-first-cell"], 8))).toBe("a-very-…");
	});

	test("honours a custom separator", () => {
		expect(fitCells(["alpha", "beta"], 9, " \u00b7 ")).toBe("alpha");
	});

	test("every result fits the width", () => {
		for (const width of WIDTHS) {
			expect(visibleWidth(fitCells(["alpha", "beta", "gamma", "delta"], width, " | "))).toBeLessThanOrEqual(width);
		}
	});
});

describe("indentBlockLines", () => {
	test("prefixes every line with the indent", () => {
		const lines = indentBlockLines(["one", "two"], 40, { indent: BODY_INDENT });
		expect(lines.map(visibleText)).toEqual(["one", "two"]);
		expect(lines.map((line) => columnOf(line, visibleText(line)))).toEqual([BODY_INDENT, BODY_INDENT]);
	});

	test("defaults to no indent", () => {
		expect(indentBlockLines(["one"], 40)).toEqual(["one"]);
	});

	test("drops trailing lines with no content", () => {
		const lines = indentBlockLines(["a", "", "b", ""], 40, { indent: BODY_INDENT });
		expect(lines.map(visibleText)).toEqual(["a", "", "b"]);
	});

	test("treats a background-padded line as blank when trimming", () => {
		const padded = "\u001b[49m      \u001b[49m";
		const lines = indentBlockLines(["a", padded], 40, { indent: 1 });
		expect(lines).toHaveLength(1);
		expect(visibleText(lines[0])).toBe("a");
	});

	test("keeps a leading blank by default", () => {
		const lines = indentBlockLines(["", "a"], 40, { indent: BODY_INDENT });
		expect(lines).toHaveLength(2);
		expect(visibleText(lines[0])).toBe("");
		expect(visibleText(lines[1])).toBe("a");
	});

	test("drops leading blanks when asked", () => {
		expect(indentBlockLines(["", "a", ""], 40, { indent: BODY_INDENT, trimLeading: true }).map(visibleText)).toEqual([
			"a",
		]);
	});

	test("keeps trailing blanks when asked", () => {
		const lines = indentBlockLines(["a", ""], 40, { indent: BODY_INDENT, trimTrailing: false });
		expect(lines).toHaveLength(2);
		expect(visibleText(lines[1])).toBe("");
	});

	test("passes an image sequence through unprefixed", () => {
		const image = "\u001b_Gabc";
		expect(indentBlockLines([image], 40, { indent: BODY_INDENT })).toEqual([image]);
	});

	test("clips every line to the width it was given", () => {
		for (const line of indentBlockLines(["x".repeat(100)], 10, { indent: BODY_INDENT })) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(10);
		}
	});

	test("clips a body line with the requested suffix", () => {
		const [line] = indentBlockLines(["x".repeat(20)], 10, { indent: BODY_INDENT, bodyClip: "…" });
		expect(stripTerminalSequences(line ?? "").endsWith("…")).toBe(true);
		expect(visibleWidth(line ?? "")).toBeLessThanOrEqual(10);
	});

	test("leaves a line that fits exactly at the width unclipped", () => {
		const body = "x".repeat(8);
		const [line] = indentBlockLines([body], 10, { indent: BODY_INDENT, bodyClip: "…" });
		expect(visibleWidth(line ?? "")).toBe(10);
		expect(line?.endsWith(body)).toBe(true);
	});

	test("measures the fit in columns, so a wide glyph is not clipped by length", () => {
		// Two characters, four columns: it fits a six-column block and must keep both.
		const [line] = indentBlockLines(["你好"], 6, { indent: BODY_INDENT, bodyClip: "…" });
		expect(line).toContain("你好");
		expect(visibleWidth(line ?? "")).toBe(6);
	});

	test("clips a line carrying a tab instead of trusting its measured width", () => {
		const [line] = indentBlockLines([`a\tb${"x".repeat(40)}`], 10, { indent: BODY_INDENT, bodyClip: "…" });
		expect(visibleWidth(line ?? "")).toBeLessThanOrEqual(10);
	});

	test("leads with a headline at the base and the body directly under it", () => {
		const lines = indentBlockLines(["read src/cli.ts", "a", "b"], 40, { indent: BODY_INDENT, headline: true });
		expect(lines[0]).toBe("read src/cli.ts");
		expect(lines.slice(1).map(visibleText)).toEqual(["a", "b"]);
		expect(lines.slice(1).map((line) => columnOf(line, visibleText(line)))).toEqual([BODY_INDENT, BODY_INDENT]);
	});

	test("drops the body's own leading blank under a headline", () => {
		const lines = indentBlockLines(["write src/a.ts", "", "body"], 40, {
			indent: BODY_INDENT,
			headline: true,
			trimLeading: true,
		});
		expect(lines.map(visibleText)).toEqual(["write src/a.ts", "body"]);
	});

	test("keeps interior blanks indented under a headline", () => {
		const lines = indentBlockLines(["read", "a", "", "b"], 40, { indent: BODY_INDENT, headline: true });
		expect(lines).toHaveLength(4);
		expect(visibleText(lines[2])).toBe("");
		expect(visibleWidth(lines[2] ?? "")).toBe(BODY_INDENT);
	});

	test("skips a leading blank when picking the headline", () => {
		const lines = indentBlockLines(["", "read", "a"], 40, { indent: BODY_INDENT, headline: true });
		expect(lines[0]).toBe("read");
		expect(visibleText(lines[1])).toBe("a");
	});

	test("indents a headline at a base beyond zero", () => {
		const lines = indentBlockLines(["read", "a"], 40, { indent: 4, headline: true });
		expect(columnOf(lines[0], "read")).toBe(2);
		expect(columnOf(lines[1], "a")).toBe(4);
	});

	test("never moves a headline left of the margin", () => {
		const lines = indentBlockLines(["read", "a"], 40, { indent: 1, headline: true });
		expect(lines[0]).toBe("read");
		expect(columnOf(lines[1], "a")).toBe(1);
	});

	test("emits only the headline for a headline-only block", () => {
		expect(indentBlockLines(["read"], 40, { indent: BODY_INDENT, headline: true })).toEqual(["read"]);
	});

	test("draws a rail glyph in the body's first indent column", () => {
		const lines = indentBlockLines(["a", "b"], 40, { indent: BODY_INDENT, rail: "╎" });
		expect(lines).toHaveLength(2);
		expect(lines[0]?.startsWith("╎")).toBe(true);
		expect(lines.map((line) => line.replace("╎", "").trim())).toEqual(["a", "b"]);
	});

	test("keeps the headline un-railed and the rail at the base indent", () => {
		const lines = indentBlockLines(["read", "a", "b"], 40, { indent: BODY_INDENT, rail: "╎", headline: true });
		expect(lines[0]).toBe("read");
		expect(lines[1]?.startsWith("╎")).toBe(true);
		expect(lines[2]?.startsWith("╎")).toBe(true);
	});

	test("places a base-indented rail under its headline", () => {
		const lines = indentBlockLines(["read", "a"], 40, { indent: 4, rail: "╎", headline: true });
		expect(columnOf(lines[0], "read")).toBe(2);
		expect(columnOf(lines[1], "╎")).toBe(2);
		expect(lines[1]?.replace("╎", "").trim()).toBe("a");
	});

	test("ignores a rail below the body indent", () => {
		const [line] = indentBlockLines(["a"], 40, { indent: 1, rail: "╎" });
		expect(visibleText(line)).toBe("a");
		expect(line).not.toContain("╎");
	});

	test("keeps a call's continuation lines unrailed", () => {
		const lines = indentBlockLines(["edit", "src/a/long/path.ts", "", "-1 a", "+1 b"], 40, {
			indent: BODY_INDENT,
			rail: "╎",
			headline: true,
			railAfterCall: true,
		});
		expect(lines[0]).toBe("edit");
		expect(visibleText(lines[1])).toBe("src/a/long/path.ts");
		expect(lines[1]).not.toContain("╎");
		expect(lines[2]?.replace("╎", "").trim()).toBe("");
		expect(lines[2]?.startsWith("╎")).toBe(true);
		expect(lines.slice(3).map((line) => line.replace("╎", "").trim())).toEqual(["-1 a", "+1 b"]);
		expect(lines[3]?.startsWith("╎")).toBe(true);
	});

	test("rails everything when the call has no blank separator", () => {
		const lines = indentBlockLines(["edit", "a", "b"], 40, {
			indent: BODY_INDENT,
			rail: "╎",
			headline: true,
			railAfterCall: true,
		});
		expect(lines[0]).toBe("edit");
		expect(lines[1]).not.toContain("╎");
		expect(lines[2]).not.toContain("╎");
		expect(lines.slice(1).map(visibleText)).toEqual(["a", "b"]);
	});

	test("ignores railAfterCall without a rail", () => {
		const lines = indentBlockLines(["edit", "a", "", "b"], 40, {
			indent: BODY_INDENT,
			headline: true,
			railAfterCall: true,
		});
		expect(lines.every((line) => !line.includes("╎"))).toBe(true);
		expect(lines.map(visibleText)).toEqual(["edit", "a", "", "b"]);
	});

	test("starts the rail at the body when railAfterCall is off", () => {
		const lines = indentBlockLines(["edit", "a", "", "b"], 40, {
			indent: BODY_INDENT,
			rail: "╎",
			headline: true,
		});
		expect(lines[0]).toBe("edit");
		expect(lines.slice(1).every((line) => line.startsWith("╎"))).toBe(true);
	});
});

describe("bodyLines", () => {
	test("renders the inner at the width the indent leaves", () => {
		let seen = 0;
		bodyLines(
			innerOf(["x"], (width) => {
				seen = width;
			}),
			20,
			3,
		);
		expect(seen).toBe(17);
	});

	test("leaves the lines unindented", () => {
		expect(bodyLines(innerOf(["a", "b"]), 40, 2)).toEqual(["a", "b"]);
	});

	test("renders nothing for an absent inner", () => {
		expect(bodyLines(undefined, 40, 2)).toEqual([]);
	});

	test("keeps at least one column for the body", () => {
		let seen = 0;
		bodyLines(
			innerOf(["x"], (width) => {
				seen = width;
			}),
			1,
			4,
		);
		expect(seen).toBe(1);
	});
});

describe("indentedLines", () => {
	test("renders the inner at the reduced width", () => {
		let seen = 0;
		indentedLines(
			innerOf(["x"], (width) => {
				seen = width;
			}),
			20,
			{ indent: 3 },
		);
		expect(seen).toBe(17);
	});

	test("indents the inner's lines", () => {
		const lines = indentedLines(innerOf(["a", "b"]), 40, { indent: BODY_INDENT });
		expect(lines.map(visibleText)).toEqual(["a", "b"]);
		expect(lines.map((line) => columnOf(line, visibleText(line)))).toEqual([BODY_INDENT, BODY_INDENT]);
	});

	test("renders nothing for an absent inner", () => {
		expect(indentedLines(undefined, 40, { indent: BODY_INDENT })).toEqual([]);
	});

	test("renders the inner at the width the rail leaves", () => {
		let seen = 0;
		indentedLines(
			innerOf(["x"], (width) => {
				seen = width;
			}),
			20,
			{ indent: BODY_INDENT, rail: "╎" },
		);
		expect(seen).toBe(18);
	});

	test("rails the inner's lines", () => {
		const lines = indentedLines(innerOf(["a", "b"]), 40, { indent: BODY_INDENT, rail: "╎" });
		expect(lines.every((line) => line.startsWith("╎"))).toBe(true);
		expect(lines.map((line) => line.replace("╎", "").trim())).toEqual(["a", "b"]);
	});
});

describe("plainRule", () => {
	test("is a full fill of the width", () => {
		expect(plainRule(fakeTheme, 4)).toBe(RULE_GLYPH.repeat(4));
		expect(visibleWidth(plainRule(fakeTheme, 37))).toBe(37);
	});

	test("never renders zero columns", () => {
		expect(visibleWidth(plainRule(fakeTheme, 0))).toBe(1);
	});
});

describe("titleRule", () => {
	test("puts the label first and fills to the edge", () => {
		const line = titleRule(fakeTheme, 12, "Docs");
		expect(line.startsWith("Docs")).toBe(true);
		expect(line).toContain(RULE_GLYPH);
		expect(line.indexOf(RULE_GLYPH)).toBeGreaterThan("Docs".length);
		expect(visibleWidth(line)).toBe(12);
	});

	test("degrades to a plain rule rather than truncating the label", () => {
		expect(titleRule(fakeTheme, 6, "Extensions")).toBe(RULE_GLYPH.repeat(6));
	});

	test("trims the label and skips an empty one", () => {
		const line = titleRule(fakeTheme, 12, "  Docs  ");
		expect(line.startsWith("Docs")).toBe(true);
		expect(visibleWidth(line)).toBe(12);
		expect(titleRule(fakeTheme, 6, "   ")).toBe(RULE_GLYPH.repeat(6));
	});

	test("paints the label with the title role", () => {
		expect(titleRule(coloringTheme, 6, "Doc")).toBe("[accent]Doc [borderMuted]──");
	});

	test("every result fits the width", () => {
		for (const width of WIDTHS) {
			expect(visibleWidth(titleRule(fakeTheme, width, "Extensions"))).toBeLessThanOrEqual(width);
		}
	});
});

describe("centeredRule", () => {
	test("centers the label between the fill", () => {
		const line = stripTerminalSequences(centeredRule(fakeTheme, 10, "x"));
		const left = line.indexOf("x");
		const right = line.length - line.indexOf("x") - 1;
		expect(visibleWidth(line)).toBe(10);
		expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
	});

	test("gives the odd spare column to the right", () => {
		const line = stripTerminalSequences(centeredRule(fakeTheme, 12, "x"));
		const left = line.indexOf("x");
		const right = line.length - line.indexOf("x") - 1;
		expect(right).toBe(left + 1);
	});

	test("degrades to a plain rule when the label does not fit", () => {
		expect(centeredRule(fakeTheme, 4, "turn 1")).toBe(RULE_GLYPH.repeat(4));
	});

	test("honours the glyph, padding, and roles", () => {
		expect(centeredRule(coloringTheme, 11, "turn 1", { glyph: "╌", pad: 0, labelRole: "accent" })).toBe(
			"[border]╌╌[accent]turn 1[border]╌╌╌",
		);
	});

	test("every result fits the width", () => {
		for (const width of WIDTHS) {
			const line = centeredRule(fakeTheme, width, "turn 123");
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(stripTerminalSequences(line).length).toBeGreaterThan(0);
		}
	});
});
