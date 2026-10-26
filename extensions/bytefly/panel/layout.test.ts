/**
 * The arithmetic the panel's frame is built from: the display entries per
 * section and their focus keys, one navigation key's cursor move, the chrome the
 * three sections share, and the one height they agree on.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ListCursor } from "../../../lib/tui/cursor.ts";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { enabledItem, pathRow, settingsSnapshot } from "../../../test/helpers/fixtures/bytefly.ts";
import { attentionSegments } from "./format.ts";
import { buildPanelModel } from "./join.ts";
import { resourceKey } from "../picker/resources.ts";
import { settingViews } from "./settings.ts";
import { entriesOf, entryKey, isSelectable, nextRow, selectableRange, settingEntries } from "./tui/entries.ts";
import {
	BODY_START,
	FRAME_ROWS,
	detailRows,
	groupLine,
	headerLine,
	noticeLine,
	panelFrame,
	savedLine,
	tabsLine,
	totalRows,
} from "./tui/frame.ts";
import { clampSelection, firstRow, lastRow, moveRows, retainFocus } from "./tui/nav.ts";
import { isWide } from "./tui/panes.ts";

describe("panel entries", () => {
	test("interleaves group headings and rows in model order", () => {
		const model = buildPanelModel({
			items: [pathRow("/agent/extensions/a.ts"), enabledItem("plan")],
			reports: [],
			agentDir: "/agent",
		});
		const entries = entriesOf(model);

		expect(entries.map((entry) => entry.kind)).toEqual(["group", "row", "group", "row"]);
		expect(entries[1] && entryKey(entries[1])).toBe(resourceKey(enabledItem("plan")));
		expect(entries[3] && entryKey(entries[3])).toBe("auto:/agent/extensions/a.ts");
	});

	test("groups the Settings list under its four headings, in catalogue order", () => {
		const entries = settingEntries(settingViews(settingsSnapshot(), "global"));

		expect(entries.filter((entry) => entry.kind === "group").map((entry) => entry.label)).toEqual([
			"Startup",
			"Notifications",
			"Session",
			"Price",
		]);
		expect(entries.filter((entry) => entry.kind === "setting")).toHaveLength(12);
		expect(entryKey(entries[1])).toBe("byteflyUi");
		expect(entryKey(entries.at(-1))).toBe("price.budget");
	});

	test("marks only rows selectable and skips headings when stepping", () => {
		const entries = entriesOf(
			buildPanelModel({
				items: [pathRow("/agent/extensions/a.ts"), enabledItem("plan")],
				reports: [],
				agentDir: "/agent",
			}),
		);

		expect(isSelectable(entries[0])).toBe(false);
		expect(isSelectable(entries[1])).toBe(true);
		expect(nextRow(entries, 0, 1)).toBe(1);
		expect(nextRow(entries, 1, 1)).toBe(3);
		expect(nextRow(entries, 1, -1)).toBeUndefined();
		expect(nextRow(entries, 3, 1)).toBeUndefined();
	});

	test("counts a window in selectable rows, not display entries", () => {
		const entries = entriesOf(
			buildPanelModel({
				items: [pathRow("/agent/extensions/a.ts"), enabledItem("plan")],
				reports: [],
				agentDir: "/agent",
			}),
		);

		expect(selectableRange(entries, { start: 0, end: 2 })).toEqual({ start: 0, end: 1, total: 2 });
		expect(selectableRange(entries, { start: 2, end: 4 })).toEqual({ start: 1, end: 2, total: 2 });
		expect(selectableRange(entries, { start: 0, end: 4 })).toEqual({ start: 0, end: 2, total: 2 });
	});
});

describe("panel cursor arithmetic", () => {
	const model = buildPanelModel({
		items: [enabledItem("alpha"), pathRow("/agent/extensions/a.ts"), enabledItem("zulu")],
		reports: [],
		agentDir: "/agent",
	});
	const entries = entriesOf(model);
	const cursor = (): ListCursor => new ListCursor(() => {});

	test("finds the first and last selectable row", () => {
		expect(firstRow(entries)).toBe(1);
		expect(lastRow(entries)).toBe(entries.length - 1);
		expect(firstRow([{ kind: "group", key: "g", label: "g", count: 0 }])).toBeUndefined();
		expect(lastRow([{ kind: "group", key: "g", label: "g", count: 0 }])).toBeUndefined();
	});

	test("keeps the focus on the same key across a rebuild", () => {
		const list = cursor();
		list.selected = 0;
		const remembered = entryKey(entries[4]);
		retainFocus(entries, list, remembered);
		expect(entryKey(entries[list.selected])).toBe(remembered);

		// A row that is already focused is left alone.
		const rowKey = entryKey(entries[1]);
		list.selected = 1;
		retainFocus(entries, list, "missing");
		expect(entryKey(entries[list.selected])).toBe(rowKey);
	});

	test("clamps to the nearest row above, then below", () => {
		const list = cursor();

		list.selected = 3;
		clampSelection(entries, list);
		expect(list.selected).toBe(2);

		list.selected = 0;
		clampSelection(entries, list);
		expect(list.selected).toBe(1);

		list.selected = entries.length + 5;
		clampSelection(entries, list);
		expect(list.selected).toBe(entries.length - 1);
	});

	test("moves by rows while skipping headings and clamping at the end", () => {
		const list = cursor();
		list.selected = 1;
		moveRows(entries, list, 1);
		expect(list.selected).toBe(2);

		moveRows(entries, list, 99);
		expect(list.selected).toBe(lastRow(entries)!);

		const before = list.selected;
		moveRows(entries, list, 0);
		expect(list.selected).toBe(before);
	});
});

describe("panel frame arithmetic", () => {
	test("reads terminal rows from a number or a getter and rejects nonsense", () => {
		expect(totalRows(24)).toBe(24);
		expect(totalRows(() => 40)).toBe(40);
		for (const bad of [undefined, 0, -1, Number.NaN]) expect(totalRows(bad)).toBeUndefined();
	});

	test("sizes the bottom pane from the free height", () => {
		expect(detailRows(false, undefined)).toBe(3);
		expect(detailRows(true, undefined)).toBe(8);
		expect(detailRows(false, 24)).toBe(3);
		expect(detailRows(true, 24)).toBe(14);
		expect(detailRows(false, 10)).toBe(0);
		expect(detailRows(true, 10)).toBe(0);
		expect(detailRows(false, 11)).toBe(1);
	});

	test("matches the body offset the click mapping relies on", () => {
		expect(BODY_START).toBe(3);
		expect(FRAME_ROWS).toBe(6);
	});

	test("draws the header rule with the attention at its right edge", () => {
		const colored = headerLine(coloringTheme, 80, "Bytefly", [
			{ text: "1 missing", color: "bad" },
			{ text: "unsaved changes", color: "warn" },
		]);
		const plain = headerLine(fakeTheme, 80, "Bytefly", [
			{ text: "1 missing", color: "bad" },
			{ text: "unsaved changes", color: "warn" },
		]);

		expect(colored).toContain("[accent]Bytefly");
		expect(colored).toContain("[error]1 missing");
		expect(colored).toContain("[warning]unsaved changes");
		expect(visibleWidth(plain)).toBe(80);
		// The attention sits at the edge, after the fill rather than instead of it.
		expect(plain.endsWith("unsaved changes")).toBe(true);
		expect(plain.startsWith("Bytefly")).toBe(true);
	});

	test("drops the whole attention line rather than half a word on a narrow terminal", () => {
		const narrow = headerLine(fakeTheme, 16, "Bytefly", [{ text: "1 missing", color: "bad" }]);
		const fits = headerLine(fakeTheme, 24, "Bytefly", [{ text: "1 missing", color: "bad" }]);

		expect(narrow).toContain("Bytefly");
		expect(narrow).not.toContain("missing");
		expect(visibleWidth(narrow)).toBe(16);
		// 20 columns of rule and attention fit in 24, so the statement is kept whole.
		expect(fits).toContain("1 missing");
		expect(visibleWidth(fits)).toBeLessThanOrEqual(24);
	});

	test("draws the tab row with counts, the active tab accented, and the write scope", () => {
		const line = tabsLine(
			coloringTheme,
			100,
			"settings",
			{ extensions: 10, skills: 2, settings: 12 },
			{
				scope: "Global",
			},
		);
		const plain = tabsLine(
			fakeTheme,
			100,
			"settings",
			{ extensions: 10, skills: 2, settings: 12 },
			{
				scope: "Global",
			},
		);

		expect(line).toContain("[dim]Extensions");
		expect(line).toContain("[accent]Settings");
		expect(plain).toContain("Settings 12");
		expect(line).toContain("[muted]writes Global");
		expect(visibleWidth(plain)).toBe(100);
		// The scope is the right-hand cell, so the tabs stay left-aligned under the title.
		expect(plain.trimEnd().endsWith("writes Global")).toBe(true);
	});

	test("shows the filter chips between the tabs and the scope", () => {
		const plain = tabsLine(
			fakeTheme,
			120,
			"extensions",
			{ extensions: 10, skills: 2, settings: 12 },
			{
				chips: [
					{ text: "/workt", color: "meta" },
					{ text: "needs attention", color: "warn" },
				],
				scope: "Project",
			},
		);
		const warnChip = tabsLine(
			coloringTheme,
			200,
			"extensions",
			{ extensions: 10, skills: 2, settings: 12 },
			{
				chips: [{ text: "needs attention", color: "warn" }],
				scope: "Project",
			},
		);

		expect(plain).toContain("/workt");
		expect(warnChip).toContain("[warning]needs attention");
		expect(plain).toContain("writes Project");
		// The chips sit between the tabs and the scope, not after it.
		expect(plain.indexOf("/workt")).toBeLessThan(plain.indexOf("writes Project"));
		expect(visibleWidth(plain)).toBe(120);
	});

	test("sanitizes a group heading and clips it to the width", () => {
		const line = groupLine(fakeTheme, 40, { label: "bad\u001b[31mgroup", count: 12 });

		expect(line).toContain("group");
		expect(line).toContain("(12)");
		expect(line).not.toContain("\u001b");
		expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});

	test("clips a notice like the hint it replaces", () => {
		const line = noticeLine(fakeTheme, 24, `refused: ${"a path ".repeat(10)}`);

		expect(line).toContain("refused");
		expect(visibleWidth(line)).toBeLessThanOrEqual(24);
	});

	test("adds the saved marker only after a change", () => {
		expect(savedLine(fakeTheme, 80, false)).toEqual([]);
		const line = savedLine(coloringTheme, 80, true)[0];
		expect(line).toContain("[warning]Saved · reload to apply");
		expect(visibleWidth(line ?? "")).toBeLessThanOrEqual(80);
	});

	test("says the same thing about the whole set whatever the list is narrowed to", () => {
		const model = buildPanelModel({
			items: [enabledItem("alpha")],
			reports: [],
			agentDir: "/agent",
		});

		expect(attentionSegments({ rows: 1, off: 0, missing: 0, degraded: 0 }, false).map((one) => one.text)).toEqual([
			"all clear",
		]);
		expect(attentionSegments({ rows: 1, off: 0, missing: 1, degraded: 0 }, true).map((one) => one.text)).toEqual([
			"1 missing",
			"unsaved changes",
		]);
		expect(model.rows).toHaveLength(1);
	});
});

describe("the one height the sections share", () => {
	const entries = (count: number) =>
		Array.from({ length: count }, () => ({
			kind: "setting" as const,
			setting: settingViews(settingsSnapshot(), "global")[0]!,
		}));

	const frame = (options: {
		rows: number | undefined;
		width: number;
		entries: ReturnType<typeof entries>;
		tallest: number;
		side?: boolean;
	}): string[] =>
		panelFrame({
			theme: fakeTheme,
			viewportRows: options.rows,
			cursor: new ListCursor(() => {}),
			width: options.width,
			header: "Bytefly",
			tabs: "tabs",
			entries: options.entries,
			detail: ["detail"],
			hint: "hint",
			emptyLabel: "none",
			tallest: options.tallest,
			side: options.side === true ? (rows) => Array.from({ length: rows }, () => "side") : undefined,
			draw: () => "row",
		}).lines;

	test("pads a short section to the tallest one, so the frame never resizes", () => {
		const short = frame({ rows: 24, width: 120, entries: entries(2), tallest: 16, side: true });
		const tall = frame({ rows: 24, width: 120, entries: entries(16), tallest: 16, side: true });

		expect(short).toHaveLength(tall.length);
		expect(short).toHaveLength(FRAME_ROWS + 16);
		// The padding is blank body rows, so the list's own content is unchanged.
		expect(short.filter((line) => line === "").length).toBeGreaterThan(1);
	});

	test("keeps the frame inside the terminal at every width and height", () => {
		for (const rows of [8, 12, 24, 40]) {
			for (const width of [46, 80, 120]) {
				const lines = frame({ rows, width, entries: entries(16), tallest: 16, side: isWide(width) });
				expect(lines.length).toBeLessThanOrEqual(rows);
				for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("scrolls a section longer than the shared height and says so", () => {
		const lines = frame({ rows: 24, width: 120, entries: entries(40), tallest: 16, side: true });

		expect(lines).toHaveLength(FRAME_ROWS + 16);
		expect(lines.some((line) => line.includes("showing"))).toBe(true);
	});
});
