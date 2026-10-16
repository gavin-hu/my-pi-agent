import { describe, expect, test } from "bun:test";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme } from "../../../test/helpers/fakes.ts";
import { headlineWithToolName, toolBlockLines } from "./component.ts";

/** A stand-in for a tool's own renderer, recording the width it was asked for. */
const innerOf = (lines: string[], onWidth?: (width: number) => void): Component => ({
	render: (width) => {
		onWidth?.(width);
		return lines;
	},
	invalidate: () => {},
});

describe("toolBlockLines", () => {
	test("indents the body by BODY_INDENT", () => {
		expect(toolBlockLines(innerOf(["one", "two"]), 40, 0)).toEqual(["  one", "  two"]);
	});

	test("adds outputPad to the indent", () => {
		expect(toolBlockLines(innerOf(["x"]), 40, 2)[0]).toBe(`${" ".repeat(4)}x`);
	});

	test("renders the inner at the reduced width", () => {
		let seen = 0;
		toolBlockLines(
			innerOf(["x"], (width) => {
				seen = width;
			}),
			20,
			1,
		);
		expect(seen).toBe(17);
	});

	test("drops trailing lines with no content", () => {
		expect(toolBlockLines(innerOf(["a", ""]), 40, 0)).toEqual(["  a"]);
	});

	test("drops a self-shell's leading blanks when asked", () => {
		expect(toolBlockLines(innerOf(["", "a"]), 40, 0, { trimLeading: true })).toEqual(["  a"]);
	});

	test("leads with the headline and the body directly under it", () => {
		expect(toolBlockLines(innerOf(["read src/cli.ts", "a", "b"]), 40, 0, { headline: true })).toEqual([
			"read src/cli.ts",
			"  a",
			"  b",
		]);
	});

	test("drops the body's own blank under the headline", () => {
		expect(
			toolBlockLines(innerOf(["write src/a.ts", "", "body"]), 40, 0, { headline: true, trimLeading: true }),
		).toEqual(["write src/a.ts", "  body"]);
	});

	test("skips a leading blank when picking the headline", () => {
		expect(toolBlockLines(innerOf(["", "read src/cli.ts"]), 40, 0, { headline: true })).toEqual(["read src/cli.ts"]);
	});

	test("rewrites a shell prompt in the headline", () => {
		expect(toolBlockLines(innerOf(["$ bun run check", "out"]), 40, 0, { headline: true, toolName: "bash" })[0]).toBe(
			"bash bun run check",
		);
	});

	test("recolours a shell call's command through the frame", () => {
		const lines = toolBlockLines(innerOf(["\u001b[1m$ ls\u001b[0m"]), 40, 0, {
			headline: true,
			toolName: "bash",
			theme: coloringTheme,
		});
		expect(lines).toEqual(["\u001b[1mbash \u001b[22m[text]ls\u001b[0m"]);
	});

	test("renders nothing for an absent inner", () => {
		expect(toolBlockLines(undefined, 40, 0)).toEqual([]);
	});

	test("passes an image sequence through unprefixed", () => {
		const image = "\u001b_Gabc";
		expect(toolBlockLines(innerOf([image]), 40, 0)).toEqual([image]);
	});

	test("clips every line to the width it was given", () => {
		for (const line of toolBlockLines(innerOf(["x".repeat(100)]), 10, 0)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(10);
		}
	});
});

describe("headlineWithToolName", () => {
	test("replaces a shell prompt with the tool name", () => {
		expect(headlineWithToolName("$ bun run check", "bash")).toBe("bash bun run check");
		expect(headlineWithToolName("> Get-ChildItem", "powershell")).toBe("powershell Get-ChildItem");
	});

	test("leaves a headline that already names the tool alone", () => {
		expect(headlineWithToolName("read src/cli.ts:1-8", "read")).toBe("read src/cli.ts:1-8");
	});

	test("rewrites the prompt in place, keeping its styling, when given no theme", () => {
		expect(headlineWithToolName("\u001b[1m$ ls\u001b[0m", "bash")).toBe("\u001b[1mbash ls\u001b[0m");
	});

	test("repaints the command in label so only the tool name spends the accent", () => {
		expect(headlineWithToolName("\u001b[1m$ bun run check\u001b[0m", "bash", coloringTheme)).toBe(
			"\u001b[1mbash \u001b[22m[text]bun run check\u001b[0m",
		);
	});

	test("leaves a headline that is not a shell prompt untouched even with a theme", () => {
		expect(headlineWithToolName("read src/cli.ts:1-8", "read", coloringTheme)).toBe("read src/cli.ts:1-8");
	});

	test("sanitizes the tool name", () => {
		expect(headlineWithToolName("$ ls", "ba\u0007sh")).toBe("ba sh ls");
	});
});
