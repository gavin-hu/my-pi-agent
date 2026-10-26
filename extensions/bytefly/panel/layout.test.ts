/**
 * The arithmetic the panel's frame is built from: the flat display entries per
 * section and their focus keys, one navigation key's cursor move, and the row
 * budget a short terminal gives way in.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ListCursor } from "../../../lib/tui/cursor.ts";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { enabledItem, pathRow, settingsSnapshot } from "../../../test/helpers/fixtures/bytefly.ts";
import { settingsSummarySegments } from "./format.ts";
import { buildPanelModel } from "./join.ts";
import { resourceKey } from "../picker/resources.ts";
import { settingViews } from "./settings.ts";
import { entriesOf, entryKey, isSelectable, nextRow, selectableRange, settingEntries } from "./tui/entries.ts";
import {
	BODY_START,
	countsLine,
	detailRows,
	fitOptionalLines,
	groupLine,
	noticeLine,
	savedLine,
	sectionBar,
	totalRows,
} from "./tui/frame.ts";
import { clampSelection, firstRow, lastRow, moveRows, retainFocus } from "./tui/nav.ts";

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

	test("builds the Settings list flat, in catalogue order, with no headings", () => {
		const entries = settingEntries(settingViews(settingsSnapshot(), "global"));

		expect(entries).toHaveLength(12);
		expect(entries.every((entry) => entry.kind === "setting")).toBe(true);
		expect(entryKey(entries[0])).toBe("byteflyUi");
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

	test("sizes the detail pane from the free height", () => {
		expect(detailRows(false, undefined)).toBe(3);
		expect(detailRows(true, undefined)).toBe(8);
		expect(detailRows(false, 24)).toBe(3);
		expect(detailRows(true, 24)).toBe(14);
		expect(detailRows(false, 10)).toBe(0);
		expect(detailRows(true, 10)).toBe(0);
		expect(detailRows(false, 11)).toBe(1);
	});

	test("drops the range row, note, detail blank, and detail pane in that order", () => {
		const input = {
			body: ["note", "r1", "r2", "r3", "r4"],
			note: "note",
			range: "range",
			detail: ["d1", "d2"],
		};

		const roomy = fitOptionalLines({ ...input, viewportRows: 20 });
		expect(roomy).toMatchObject({ range: "range", noteShown: true, detailBlank: true });
		expect(roomy.detail).toEqual(["d1", "d2"]);

		const rangeDropped = fitOptionalLines({ ...input, viewportRows: 14 });
		expect(rangeDropped.range).toBeUndefined();
		expect(rangeDropped.noteShown).toBe(true);
		expect(rangeDropped.detail).toEqual(["d1", "d2"]);

		const noteDropped = fitOptionalLines({ ...input, viewportRows: 13 });
		expect(noteDropped.noteShown).toBe(false);
		expect(noteDropped.body).toEqual(["r1", "r2", "r3", "r4"]);
		expect(noteDropped.detailBlank).toBe(true);

		const blankDropped = fitOptionalLines({ ...input, viewportRows: 12 });
		expect(blankDropped.detailBlank).toBe(false);
		expect(blankDropped.detail).toEqual(["d1", "d2"]);

		const paneDropped = fitOptionalLines({ ...input, viewportRows: 11 });
		expect(paneDropped.detail).toEqual([]);
	});

	test("keeps every optional row when the height is unknown", () => {
		const fitted = fitOptionalLines({
			body: ["note"],
			note: "note",
			range: "range",
			detail: ["d1"],
			viewportRows: undefined,
		});

		expect(fitted).toMatchObject({ noteShown: true, detailBlank: true, range: "range" });
	});

	test("draws the section bar with the active section accented", () => {
		const bar = sectionBar(
			coloringTheme,
			120,
			"settings",
			countsLine(coloringTheme, 80, settingsSummarySegments("global", 14)),
		);

		expect(bar).toContain("[dim]Extensions");
		expect(bar).toContain("[dim]Skills");
		expect(bar).toContain("[accent]Settings");
		expect(bar).toContain("[accent]Global");
		expect(bar).toContain("[muted]14 settings");
		expect(visibleWidth(bar)).toBeLessThanOrEqual(120);
	});

	test("drops whole count segments on a narrow line", () => {
		const wide = countsLine(fakeTheme, 80, settingsSummarySegments("global", 14));
		const narrow = countsLine(fakeTheme, 12, settingsSummarySegments("global", 14));

		expect(wide).toContain("14 settings");
		expect(narrow).toContain("Global");
		expect(narrow).not.toContain("14 settings");
		expect(visibleWidth(narrow)).toBeLessThanOrEqual(12);
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

	test("matches the body offset the click mapping relies on", () => {
		expect(BODY_START).toBe(3);
	});
});
