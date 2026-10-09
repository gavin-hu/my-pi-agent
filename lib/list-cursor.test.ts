import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	clampScroll,
	fitRows,
	formatRange,
	keepVisible,
	ListCursor,
	navIntent,
	selectionMarker,
	wheelDelta,
} from "./list-cursor.ts";
import { fakeTheme } from "../test/helpers/fakes.ts";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const PAGE_UP = "\x1b[5~";
const PAGE_DOWN = "\x1b[6~";
const HOME = "\x1b[H";
const END = "\x1b[F";

describe("fitRows", () => {
	test("fills the terminal minus the chrome, honouring the fallback", () => {
		expect(fitRows(20, 3, 5, 12)).toBe(15);
		expect(fitRows(undefined, 3, 5, 12)).toBe(12);
	});

	test("reserves one more row for the range row only when the list overflows", () => {
		// 10 - 2 = 8 rows, but the list is longer, so the range row costs one: 7.
		expect(fitRows(10, 20, 2, 12)).toBe(7);
		// Exactly fitting does not reserve a row.
		expect(fitRows(10, 8, 2, 12)).toBe(8);
	});
});

describe("keepVisible", () => {
	test("leaves an in-window focus and scroll alone", () => {
		expect(keepVisible(4, 6, 3)).toBe(4);
	});

	test("scrolls up to a focus above the window", () => {
		expect(keepVisible(10, 2, 3)).toBe(2);
	});

	test("scrolls down to a focus below the window", () => {
		expect(keepVisible(0, 5, 3)).toBe(3);
	});
});

describe("clampScroll", () => {
	test("bounds into [0, count - visible]", () => {
		expect(clampScroll(-1, 10, 3)).toBe(0);
		expect(clampScroll(5, 10, 3)).toBe(5);
		expect(clampScroll(100, 10, 3)).toBe(7);
	});

	test("pins to zero when nothing overflows", () => {
		expect(clampScroll(3, 2, 5)).toBe(0);
		expect(clampScroll(0, 0, 5)).toBe(0);
	});
});

describe("navIntent", () => {
	test("maps arrows and vi keys", () => {
		expect(navIntent(UP)).toBe("up");
		expect(navIntent("k")).toBe("up");
		expect(navIntent(DOWN)).toBe("down");
		expect(navIntent("j")).toBe("down");
	});

	test("maps paging and jumps", () => {
		expect(navIntent(PAGE_UP)).toBe("pageUp");
		expect(navIntent(PAGE_DOWN)).toBe("pageDown");
		expect(navIntent(HOME)).toBe("home");
		expect(navIntent(END)).toBe("end");
	});

	test("returns undefined for action keys", () => {
		expect(navIntent("d")).toBeUndefined();
		expect(navIntent("x")).toBeUndefined();
		expect(navIntent("\r")).toBeUndefined();
	});
});

describe("wheelDelta", () => {
	test("returns the delta for a wheel scroll", () => {
		expect(wheelDelta({ type: "wheel", wheelDelta: 2 } as any)).toBe(2);
	});

	test("ignores a zero delta and other events", () => {
		expect(wheelDelta({ type: "wheel", wheelDelta: 0 } as any)).toBeUndefined();
		expect(wheelDelta({ type: "click", button: "left" } as any)).toBeUndefined();
	});
});

describe("selectionMarker", () => {
	test("is the accent marker when selected and a blank otherwise", () => {
		expect(selectionMarker(fakeTheme, true)).toBe("❯ ");
		expect(selectionMarker(fakeTheme, false)).toBe("  ");
		expect(visibleWidth(selectionMarker(fakeTheme, true))).toBe(2);
	});
});

describe("formatRange", () => {
	test("renders a one-based showing row", () => {
		expect(formatRange(fakeTheme, 40, { start: 0, end: 3, total: 10 })).toBe("  showing 1–3 of 10");
	});

	test("accepts a custom label for log panes", () => {
		expect(formatRange(fakeTheme, 40, { start: 1, end: 3, total: 10, label: "line" })).toBe("  line 2–3 of 10");
	});

	test("never exceeds the width", () => {
		expect(visibleWidth(formatRange(fakeTheme, 5, { start: 100, end: 200, total: 1000 }))).toBeLessThanOrEqual(5);
	});
});

describe("ListCursor", () => {
	test("sync clamps to the list and never repaints", () => {
		let renders = 0;
		const cursor = new ListCursor(() => renders++);
		cursor.visible = 3;
		cursor.selected = 5;
		cursor.sync(2);
		expect(cursor.selected).toBe(1);
		expect(renders).toBe(0);
	});

	test("sync scrolls the window to keep the focus visible", () => {
		const cursor = new ListCursor(() => {});
		cursor.visible = 3;
		cursor.selected = 5;
		cursor.scrollTop = 0;
		cursor.sync(10);
		expect(cursor.selected).toBe(5);
		expect(cursor.scrollTop).toBe(3);
	});

	test("sync clears state for an empty list", () => {
		const cursor = new ListCursor(() => {});
		cursor.selected = 4;
		cursor.scrollTop = 4;
		cursor.sync(0);
		expect(cursor.selected).toBe(0);
		expect(cursor.scrollTop).toBe(0);
	});

	test("set repaints only when the focus moves", () => {
		let renders = 0;
		const cursor = new ListCursor(() => renders++);
		cursor.visible = 3;
		cursor.set(1, 5);
		expect(cursor.selected).toBe(1);
		expect(renders).toBe(1);
		cursor.set(1, 5);
		expect(renders).toBe(1);
		cursor.set(99, 5);
		expect(cursor.selected).toBe(4);
		expect(renders).toBe(2);
	});

	test("set ignores an empty list", () => {
		let renders = 0;
		const cursor = new ListCursor(() => renders++);
		cursor.set(2, 0);
		expect(cursor.selected).toBe(0);
		expect(renders).toBe(0);
	});

	test("by and page move by one and by a viewport", () => {
		const cursor = new ListCursor(() => {});
		cursor.visible = 3;
		cursor.by(2, 10);
		expect(cursor.selected).toBe(2);
		cursor.page(1, 10);
		expect(cursor.selected).toBe(5);
		cursor.page(-1, 10);
		expect(cursor.selected).toBe(2);
	});

	test("window reports the visible half-open range and clipped flags it", () => {
		const cursor = new ListCursor(() => {});
		cursor.visible = 3;
		cursor.scrollTop = 2;
		expect(cursor.window(10)).toEqual({ start: 2, end: 5 });
		expect(cursor.clipped(10)).toBe(true);

		cursor.scrollTop = 0;
		cursor.visible = 10;
		expect(cursor.window(3)).toEqual({ start: 0, end: 3 });
		expect(cursor.clipped(3)).toBe(false);
	});
});
