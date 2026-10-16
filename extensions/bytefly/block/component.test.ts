import { describe, expect, test } from "bun:test";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { RAIL } from "../../../lib/tui/rail.ts";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { blockStatus, headlineWithToolName, toolBlockLines } from "./component.ts";

/** A stand-in for a tool's own renderer, recording the width it was asked for. */
const innerOf = (lines: string[], onWidth?: (width: number) => void): Component => ({
	render: (width) => {
		onWidth?.(width);
		return lines;
	},
	invalidate: () => {},
});

describe("blockStatus", () => {
	test("is info while partial, bad on error, ok otherwise", () => {
		expect(blockStatus({ isPartial: true, isError: false })).toBe("info");
		expect(blockStatus({ isPartial: false, isError: true })).toBe("bad");
		expect(blockStatus({ isPartial: false, isError: false })).toBe("ok");
	});
});

describe("toolBlockLines", () => {
	test("prefixes every line with the rail", () => {
		expect(toolBlockLines(innerOf(["one", "two"]), "ok", fakeTheme, 40, 0)).toEqual([`${RAIL} one`, `${RAIL} two`]);
	});

	test("indents by outputPad", () => {
		expect(toolBlockLines(innerOf(["x"]), "ok", fakeTheme, 40, 2)[0]).toBe(`  ${RAIL} x`);
	});

	test("paints the rail in the status role", () => {
		expect(toolBlockLines(innerOf(["x"]), "bad", coloringTheme, 40, 0)[0]).toContain(`[error]${RAIL}`);
	});

	test("keeps a finished rail neutral and spends colour only while running", () => {
		expect(toolBlockLines(innerOf(["x"]), "ok", coloringTheme, 40, 0)[0]).toContain(`[dim]${RAIL}`);
		expect(toolBlockLines(innerOf(["x"]), "info", coloringTheme, 40, 0)[0]).toContain(`[accent]${RAIL}`);
	});

	test("renders the inner at the reduced width", () => {
		let seen = 0;
		toolBlockLines(
			innerOf(["x"], (width) => {
				seen = width;
			}),
			"ok",
			fakeTheme,
			20,
			1,
		);
		expect(seen).toBe(17);
	});

	test("drops trailing lines with no content", () => {
		expect(toolBlockLines(innerOf(["a", ""]), "ok", fakeTheme, 40, 0)).toEqual([`${RAIL} a`]);
	});

	test("drops a self-shell's leading blanks when asked", () => {
		expect(toolBlockLines(innerOf(["", "a"]), "ok", fakeTheme, 40, 0, { trimLeading: true })).toEqual([`${RAIL} a`]);
	});

	test("leads with an un-railed headline and one plain blank line", () => {
		expect(toolBlockLines(innerOf(["read src/cli.ts", "a", "b"]), "ok", fakeTheme, 40, 0, { headline: true })).toEqual([
			"read src/cli.ts",
			"",
			`${RAIL} a`,
			`${RAIL} b`,
		]);
	});

	test("skips a leading blank when picking the headline", () => {
		expect(toolBlockLines(innerOf(["", "read src/cli.ts"]), "ok", fakeTheme, 40, 0, { headline: true })).toEqual([
			"read src/cli.ts",
			"",
		]);
	});

	test("renders nothing for an absent inner", () => {
		expect(toolBlockLines(undefined, "ok", fakeTheme, 40, 0)).toEqual([]);
	});

	test("passes an image sequence through unprefixed", () => {
		const image = "\u001b_Gabc";
		expect(toolBlockLines(innerOf([image]), "ok", fakeTheme, 40, 0)).toEqual([image]);
	});

	test("clips every line to the width it was given", () => {
		for (const line of toolBlockLines(innerOf(["x".repeat(100)]), "ok", fakeTheme, 10, 0)) {
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

	test("rewrites the prompt in place, keeping its styling", () => {
		expect(headlineWithToolName("\u001b[1m$ ls\u001b[0m", "bash")).toBe("\u001b[1mbash ls\u001b[0m");
	});

	test("sanitizes the tool name", () => {
		expect(headlineWithToolName("$ ls", "ba\u0007sh")).toBe("ba sh ls");
	});
});
