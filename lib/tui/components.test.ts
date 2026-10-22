/**
 * Components: the design tokens, glyph vocabulary, row grammar, and gauge that
 * every surface composes from. Assertions name roles, states, ordering, and
 * column bounds, never literal column padding.
 */

import { describe, expect, test } from "bun:test";
import { eastAsianWidthType } from "get-east-asian-width";
import {
	getKeybindings,
	KeybindingsManager,
	setKeybindings,
	stripTerminalSequences,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { ansiTheme, coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import { computeGauge, DEFAULT_GAUGE_THRESHOLDS, gaugeBar, gaugeRole } from "./gauge.ts";
import { EXPAND_KEYBINDING, GLYPHS, SEPARATORS, STATUS_KEYS, expandHint, expandKey, keyHintText } from "./glyphs.ts";
import { byRunningFirst, checkbox, chip, emptyState, keyValueRow, listRow, statusRow } from "./rows.ts";
import { paint, paintPrefix, TUI_TOKENS, type TuiRole } from "./tokens.ts";

/** Column counts exercised by the width sweeps. */
const WIDTHS = Array.from({ length: 115 }, (_, index) => index + 6);

const ROLES = Object.keys(TUI_TOKENS) as TuiRole[];

describe("TUI_TOKENS", () => {
	test("every role resolves to a theme color", () => {
		for (const role of ROLES) expect(typeof TUI_TOKENS[role]).toBe("string");
	});

	test("paint routes each role through the theme's own color", () => {
		const painted = ROLES.map((role) => paint(coloringTheme, role, "x"));
		expect(painted).toEqual(ROLES.map((role) => `[${TUI_TOKENS[role]}]x`));
	});

	test("paint returns the themed text unchanged by the identity theme", () => {
		expect(paint(fakeTheme, "title", "Extensions")).toBe("Extensions");
	});

	test("status roles map to the semantic status colors", () => {
		expect(TUI_TOKENS.ok).toBe("success");
		expect(TUI_TOKENS.warn).toBe("warning");
		expect(TUI_TOKENS.bad).toBe("error");
	});

	test("structure roles map to the divider colors", () => {
		expect(TUI_TOKENS.rule).toBe("borderMuted");
		expect(TUI_TOKENS.ruleStrong).toBe("border");
	});

	test("paintPrefix routes through the role's own color", () => {
		for (const role of ROLES) expect(paintPrefix(coloringTheme, role)).toBe(`[${TUI_TOKENS[role]}]`);
	});

	test("paintPrefix drops the reset a wrapping paint carries", () => {
		for (const role of ROLES) {
			const open = paintPrefix(ansiTheme, role);
			expect(open.length).toBeGreaterThan(0);
			expect(open).not.toContain("\u001b[39m");
		}
	});
});

describe("GLYPHS", () => {
	test("every glyph is exactly one visible column", () => {
		for (const [name, glyph] of Object.entries(GLYPHS)) {
			expect(visibleWidth(glyph), name).toBe(1);
		}
	});

	test("no glyph is wide or fullwidth, so none is a fixed two columns", () => {
		const wide = new Set(["wide", "fullwidth"]);
		for (const [name, glyph] of Object.entries(GLYPHS)) {
			expect(wide.has(eastAsianWidthType(glyph.codePointAt(0) ?? 0)), `${name}=${glyph}`).toBe(false);
		}
	});

	test("glyphs are distinct, so chips stay distinguishable", () => {
		const values = Object.values(GLYPHS);
		expect(new Set(values).size).toBe(values.length);
	});
});

describe("SEPARATORS", () => {
	test("item and group separators are distinct and three columns wide", () => {
		expect(SEPARATORS.item).not.toBe(SEPARATORS.group);
		expect(visibleWidth(SEPARATORS.item)).toBe(3);
		expect(visibleWidth(SEPARATORS.group)).toBe(3);
		expect(SEPARATORS.group).toContain(GLYPHS.divider);
	});
});

describe("STATUS_KEYS", () => {
	test("keys are non-empty, untrimmed-safe, and unique", () => {
		const values = Object.values(STATUS_KEYS);
		for (const key of values) {
			expect(key.length).toBeGreaterThan(0);
			expect(key.trim()).toBe(key);
		}
		expect(new Set(values).size).toBe(values.length);
	});
});

describe("expandKey / expandHint", () => {
	test("degrades when the keybinding is unknown", () => {
		const previous = getKeybindings();
		setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
		try {
			expect(expandKey(fakeTheme)).toBe("");
			expect(expandHint(fakeTheme)).toBe("(to expand)");
		} finally {
			setKeybindings(previous);
		}
	});

	test("renders the bound key", () => {
		const previous = getKeybindings();
		setKeybindings(
			new KeybindingsManager({
				...TUI_KEYBINDINGS,
				[EXPAND_KEYBINDING]: { defaultKeys: "ctrl+o", description: "Toggle tool output" },
			}),
		);
		try {
			expect(expandKey(fakeTheme)).toBe("ctrl+o");
			expect(expandHint(fakeTheme)).toBe("(ctrl+o to expand)");
		} finally {
			setKeybindings(previous);
		}
	});
});

describe("keyHintText", () => {
	test("renders the key dim and the description muted", () => {
		expect(keyHintText(coloringTheme, "escape", "to interrupt")).toBe("[dim]escape[muted] to interrupt");
	});

	test("renders nothing for an unbound key", () => {
		expect(keyHintText(fakeTheme, "", "to interrupt")).toBe("");
	});
});

describe("listRow", () => {
	test("reserves the marker column whether or not the row is selected", () => {
		const plain = listRow(fakeTheme, 20, { label: "alpha" });
		const selected = listRow(fakeTheme, 20, { label: "alpha", selected: true });
		expect(visibleWidth(plain)).toBe(visibleWidth(selected));
		expect(selected).toContain("❯");
		expect(plain).not.toContain("❯");
	});

	test("drops the marker column when marker is false", () => {
		expect(stripTerminalSequences(listRow(fakeTheme, 20, { label: "alpha", marker: false }))).toBe("alpha");
		expect(stripTerminalSequences(listRow(fakeTheme, 20, { label: "x", glyph: "✓", marker: false }))).toBe("✓ x");
	});

	test("right-aligns the trailing meta", () => {
		const line = listRow(fakeTheme, 20, { label: "alpha", trailing: "12" });
		expect(line.endsWith("12")).toBe(true);
		expect(visibleWidth(line)).toBe(20);
	});

	test("renders an indent and a glyph before the label", () => {
		const line = stripTerminalSequences(listRow(fakeTheme, 20, { label: "x", glyph: "◼", indent: 2 }));
		expect(line.indexOf("◼")).toBeGreaterThanOrEqual(2);
		expect(line.indexOf("◼")).toBeLessThan(line.indexOf("x"));
	});

	test("renders a pre-themed leading cell between the marker and the glyph", () => {
		const line = stripTerminalSequences(listRow(fakeTheme, 20, { label: "x", leading: "◼", glyph: "✓" }));
		expect(line.indexOf("◼")).toBeLessThan(line.indexOf("✓"));
		expect(line.indexOf("✓")).toBeLessThan(line.indexOf("x"));
	});

	test("paints the label with its role", () => {
		expect(listRow(coloringTheme, 12, { label: "x", labelRole: "title" })).toContain("[accent]x");
	});

	test("keeps the trailing meta beside the label when the row asks for inline", () => {
		const line = stripTerminalSequences(listRow(fakeTheme, 40, { label: "alpha", trailing: "12", align: "inline" }));
		expect(line.indexOf("alpha")).toBeLessThan(line.indexOf("12"));
		expect(visibleWidth(line)).toBeLessThan(40);
	});

	test("an inline row clips its label before its value", () => {
		const line = stripTerminalSequences(
			listRow(fakeTheme, 14, { label: "a-very-long-label", trailing: "12", align: "inline" }),
		);
		expect(line.endsWith("12")).toBe(true);
		expect(visibleWidth(line)).toBeLessThanOrEqual(14);
	});

	test("every result fits the width", () => {
		for (const width of WIDTHS) {
			for (const align of ["end", "inline"] as const) {
				expect(
					visibleWidth(listRow(fakeTheme, width, { label: "a-very-long-label", trailing: "meta", align })),
				).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("statusRow", () => {
	test("passes the label role through, so a list can accent its focused row", () => {
		const row = { glyph: "▸", glyphRole: "ok" as const, label: "x", trailing: "" };
		expect(statusRow(coloringTheme, 30, { ...row, labelRole: "accent" })).toContain("[accent]x");
		expect(stripTerminalSequences(statusRow(fakeTheme, 30, row)).trim()).toBe("▸ x");
	});

	test("defaults the trailing meta to faint", () => {
		const row = { glyph: "▸", glyphRole: "ok" as const, label: "x", trailing: "now" };
		expect(statusRow(coloringTheme, 30, row)).toContain("[dim]now");
	});
});

describe("checkbox", () => {
	test("uses one glyph per state", () => {
		expect(checkbox(fakeTheme, true)).toBe(GLYPHS.boxOn);
		expect(checkbox(fakeTheme, false)).toBe(GLYPHS.boxOff);
	});

	test("paints on with success and off with faint", () => {
		expect(checkbox(coloringTheme, true)).toBe(`[success]${GLYPHS.boxOn}`);
		expect(checkbox(coloringTheme, false)).toBe(`[dim]${GLYPHS.boxOff}`);
	});

	test("honours an override role", () => {
		expect(checkbox(coloringTheme, true, { on: "accent" })).toBe(`[accent]${GLYPHS.boxOn}`);
	});
});

describe("chip", () => {
	test("joins a glyph and its label", () => {
		expect(stripTerminalSequences(chip(fakeTheme, "⎇", "main"))).toBe("⎇ main");
	});

	test("renders a glyph alone when there is no label", () => {
		expect(chip(fakeTheme, "⎇", "")).toBe("⎇");
	});

	test("paints both parts with one role", () => {
		expect(chip(coloringTheme, "⎇", "main", "ok")).toBe("[success]⎇ [success]main");
	});
});

describe("keyValueRow", () => {
	test("holds the value in a fixed label column, body-indented", () => {
		const short = keyValueRow(fakeTheme, 30, { label: "a", value: "on", labelWidth: 11 });
		const long = keyValueRow(fakeTheme, 30, { label: "status", value: "on", labelWidth: 11 });
		expect(short.indexOf("on")).toBe(long.indexOf("on"));
		expect(short.trimStart().startsWith("a")).toBe(true);
		expect(short.indexOf("a")).toBeGreaterThan(0);
	});

	test("every result fits the width", () => {
		for (const width of WIDTHS) {
			expect(visibleWidth(keyValueRow(fakeTheme, width, { label: "status", value: "connected" }))).toBeLessThanOrEqual(
				width,
			);
		}
	});
});

describe("emptyState", () => {
	test("returns a label line, and a hint line only when there is a hint", () => {
		expect(emptyState(fakeTheme, 30, { label: "No notes yet." })).toHaveLength(1);
		const both = emptyState(fakeTheme, 30, { label: "No notes yet.", hint: "Press a to add one." });
		expect(both).toHaveLength(2);
		expect(both[0]?.endsWith("No notes yet.")).toBe(true);
		expect(both[1]?.endsWith("Press a to add one.")).toBe(true);
	});

	test("paints the empty state faint, like the screens it replaces", () => {
		expect(emptyState(coloringTheme, 20, { label: "x" })[0]).toContain("[dim]x");
	});

	test("every line fits the width", () => {
		for (const width of WIDTHS) {
			for (const line of emptyState(fakeTheme, width, { label: "No notes yet.", hint: "Press a to add one." })) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("byRunningFirst", () => {
	interface Row {
		id: string;
		startedAt: number;
		running: boolean;
	}
	const order = byRunningFirst<Row>((row) => row.running);

	test("puts the running rows first, then orders each group by most recent start", () => {
		const rows: Row[] = [
			{ id: "done-old", startedAt: 100, running: false },
			{ id: "run-old", startedAt: 200, running: true },
			{ id: "done-new", startedAt: 300, running: false },
			{ id: "run-new", startedAt: 400, running: true },
		];
		expect(rows.toSorted(order).map((row) => row.id)).toEqual(["run-new", "run-old", "done-new", "done-old"]);
	});

	test("keeps a live re-sort stable within the finished group", () => {
		const rows: Row[] = [
			{ id: "a", startedAt: 10, running: false },
			{ id: "b", startedAt: 20, running: false },
		];
		expect(rows.toSorted(order).map((row) => row.id)).toEqual(["b", "a"]);
	});
});

describe("computeGauge", () => {
	test("spans the track from empty to full", () => {
		expect(computeGauge(0, 10)).toEqual({ filled: 0, empty: 10 });
		expect(computeGauge(100, 10)).toEqual({ filled: 10, empty: 0 });
		expect(computeGauge(62, 10)).toEqual({ filled: 6, empty: 4 });
	});

	test("rounds to the nearest cell, keeping the last one for 100%", () => {
		expect(computeGauge(48.3, 8)).toEqual({ filled: 4, empty: 4 });
		expect(computeGauge(99, 10)).toEqual({ filled: 9, empty: 1 });
		expect(computeGauge(99.9, 10)).toEqual({ filled: 9, empty: 1 });
	});

	test("forces one block for any non-zero usage", () => {
		expect(computeGauge(1, 10)).toEqual({ filled: 1, empty: 9 });
		expect(computeGauge(0.2, 8)).toEqual({ filled: 1, empty: 7 });
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
