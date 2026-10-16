import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	clampScroll,
	fitRows,
	formatRange,
	IdCursor,
	isCloseKey,
	keepVisible,
	ListCursor,
	navIntent,
	navigateList,
	navigateScroll,
	scrollList,
	selectionMarker,
	wheelDelta,
} from "./cursor.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";

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

describe("navigateList", () => {
	const cursor = (): ListCursor => {
		const c = new ListCursor(() => {});
		c.visible = 3;
		return c;
	};

	test("moves by one, by a page, and to the ends", () => {
		const c = cursor();
		expect(navigateList(DOWN, c, 10)).toBe(true);
		expect(c.selected).toBe(1);
		expect(navigateList(PAGE_DOWN, c, 10)).toBe(true);
		expect(c.selected).toBe(4);
		expect(navigateList(END, c, 10)).toBe(true);
		expect(c.selected).toBe(9);
		expect(navigateList(HOME, c, 10)).toBe(true);
		expect(c.selected).toBe(0);
	});

	test("leaves a non-navigation key to the screen", () => {
		const c = cursor();
		expect(navigateList("d", c, 10)).toBe(false);
		expect(c.selected).toBe(0);
	});
});

describe("scrollList", () => {
	test("moves the cursor by the wheel delta and marks the event handled", () => {
		const cursor = new ListCursor(() => {});
		expect(scrollList({ type: "wheel", wheelDelta: 2 } as any, cursor, 10)).toEqual({ handled: true });
		expect(cursor.selected).toBe(2);
	});

	test("returns undefined for a non-wheel event", () => {
		const cursor = new ListCursor(() => {});
		expect(scrollList({ type: "click", button: "left" } as any, cursor, 10)).toBeUndefined();
		expect(cursor.selected).toBe(0);
	});
});

describe("isCloseKey", () => {
	test("matches Escape and Ctrl+C only", () => {
		expect(isCloseKey("\x1b")).toBe(true);
		expect(isCloseKey("\x03")).toBe(true);
		expect(isCloseKey("q")).toBe(false);
		expect(isCloseKey("\r")).toBe(false);
	});
});

describe("navigateScroll", () => {
	test("moves by one and by a page, clamped", () => {
		expect(navigateScroll(DOWN, 0, 10, 3)).toBe(1);
		expect(navigateScroll(PAGE_DOWN, 0, 10, 3)).toBe(3);
		expect(navigateScroll(PAGE_UP, 5, 10, 3)).toBe(2);
		expect(navigateScroll(UP, 0, 10, 3)).toBe(0);
	});

	test("jumps to the ends", () => {
		expect(navigateScroll(HOME, 5, 10, 3)).toBe(0);
		expect(navigateScroll(END, 0, 10, 3)).toBe(7);
		expect(navigateScroll(END, 0, 2, 5)).toBe(0);
	});

	test("returns undefined for an action key", () => {
		expect(navigateScroll("d", 0, 10, 3)).toBeUndefined();
	});
});

describe("IdCursor", () => {
	const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
	const key = (item: { id: string }): string => item.id;

	test("indexOf follows the id, not the position", () => {
		const cursor = new IdCursor();
		cursor.id = "b";
		expect(cursor.indexOf(items, key)).toBe(1);
		expect(cursor.indexOf([{ id: "c" }, { id: "b" }], key)).toBe(1);
	});

	test("indexOf falls back to the first row when the id is gone or unset", () => {
		const cursor = new IdCursor();
		expect(cursor.indexOf(items, key)).toBe(0);
		cursor.id = "zzz";
		expect(cursor.indexOf(items, key)).toBe(0);
		expect(cursor.indexOf([], key)).toBe(0);
	});

	test("clamp re-anchors the id after a re-sort and bounds the scroll", () => {
		const cursor = new IdCursor();
		cursor.visible = 2;
		cursor.id = "b";
		cursor.scroll = 99;
		cursor.clamp([{ id: "c" }, { id: "a" }, { id: "b" }], key);
		expect(cursor.id).toBe("b");
		expect(cursor.scroll).toBe(1);
	});

	test("clamp clears the state for an empty list", () => {
		const cursor = new IdCursor();
		cursor.id = "a";
		cursor.scroll = 3;
		cursor.clamp([], key);
		expect(cursor.id).toBeUndefined();
		expect(cursor.scroll).toBe(0);
	});

	test("select clamps the index, anchors the id, and keeps it visible", () => {
		const cursor = new IdCursor();
		cursor.visible = 2;
		cursor.select(items, key, 99);
		expect(cursor.id).toBe("c");
		expect(cursor.scroll).toBe(1);
	});

	test("select ignores an empty list", () => {
		const cursor = new IdCursor();
		cursor.id = "a";
		cursor.select([], key, 2);
		expect(cursor.id).toBe("a");
	});

	test("ensureVisible follows keepVisible and never goes negative", () => {
		const cursor = new IdCursor();
		cursor.visible = 3;
		cursor.ensureVisible(5);
		expect(cursor.scroll).toBe(3);
		cursor.ensureVisible(1);
		expect(cursor.scroll).toBe(1);
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
