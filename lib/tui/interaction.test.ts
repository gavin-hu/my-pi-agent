/**
 * Interaction: list/cursor math, the confirmation layer, the scrollable pane,
 * the two-mode docked screen, and the footer status controller with its
 * attach/paint/detach lifecycle.
 */

import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import type { ScreenHint } from "./chrome.ts";
import { ConfirmState } from "./confirm.ts";
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
import { DockListScreen, type DetailContents, type DetailSource } from "./dock-screen.ts";
import { LinePane } from "./line-pane.ts";
import { createStatusController, type StatusChip } from "./status-controller.ts";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const PAGE_UP = "\x1b[5~";
const PAGE_DOWN = "\x1b[6~";
const HOME = "\x1b[H";
const END = "\x1b[F";

/** A complete wheel event, as the host delivers it. */
function wheelEvent(delta: number): TuiMouseEvent {
	return {
		type: "wheel",
		button: "none",
		x: 0,
		y: 0,
		screenX: 0,
		screenY: 0,
		width: 80,
		height: 24,
		shift: false,
		alt: false,
		ctrl: false,
		wheelDelta: delta,
	};
}

/** A complete non-wheel event, to prove the wheel helpers ignore it. */
function clickEvent(): TuiMouseEvent {
	return { ...wheelEvent(0), type: "click", button: "left" };
}

/** The y/N layer over a request that records its accept. */
function confirmHarness() {
	const state = new ConfirmState();
	const accepted: string[] = [];
	state.ask("Kill j1? y/N", () => accepted.push("yes"));
	return { state, accepted };
}

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
		expect(wheelDelta(wheelEvent(2))).toBe(2);
	});

	test("ignores a zero delta and other events", () => {
		expect(wheelDelta(wheelEvent(0))).toBeUndefined();
		expect(wheelDelta(clickEvent())).toBeUndefined();
	});
});

describe("navigateList", () => {
	const listCursor = (): ListCursor => {
		const cursor = new ListCursor(() => {});
		cursor.visible = 3;
		return cursor;
	};

	test("moves by one, by a page, and to the ends", () => {
		const cursor = listCursor();
		expect(navigateList(DOWN, cursor, 10)).toBe(true);
		expect(cursor.selected).toBe(1);
		expect(navigateList(PAGE_DOWN, cursor, 10)).toBe(true);
		expect(cursor.selected).toBe(4);
		expect(navigateList(END, cursor, 10)).toBe(true);
		expect(cursor.selected).toBe(9);
		expect(navigateList(HOME, cursor, 10)).toBe(true);
		expect(cursor.selected).toBe(0);
	});

	test("leaves a non-navigation key to the screen", () => {
		const cursor = listCursor();
		expect(navigateList("d", cursor, 10)).toBe(false);
		expect(cursor.selected).toBe(0);
	});
});

describe("scrollList", () => {
	test("moves the cursor by the wheel delta and marks the event handled", () => {
		const cursor = new ListCursor(() => {});
		expect(scrollList(wheelEvent(2), cursor, 10)).toEqual({ handled: true });
		expect(cursor.selected).toBe(2);
	});

	test("returns undefined for a non-wheel event", () => {
		const cursor = new ListCursor(() => {});
		expect(scrollList(clickEvent(), cursor, 10)).toBeUndefined();
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
	const rowKey = (item: { id: string }): string => item.id;

	test("indexOf follows the id, not the position", () => {
		const cursor = new IdCursor();
		cursor.id = "b";
		expect(cursor.indexOf(items, rowKey)).toBe(1);
		expect(cursor.indexOf([{ id: "c" }, { id: "b" }], rowKey)).toBe(1);
	});

	test("indexOf falls back to the first row when the id is gone or unset", () => {
		const cursor = new IdCursor();
		expect(cursor.indexOf(items, rowKey)).toBe(0);
		cursor.id = "zzz";
		expect(cursor.indexOf(items, rowKey)).toBe(0);
		expect(cursor.indexOf([], rowKey)).toBe(0);
	});

	test("clamp re-anchors the id after a re-sort and bounds the scroll", () => {
		const cursor = new IdCursor();
		cursor.visible = 2;
		cursor.id = "b";
		cursor.scroll = 99;
		cursor.clamp([{ id: "c" }, { id: "a" }, { id: "b" }], rowKey);
		expect(cursor.id).toBe("b");
		expect(cursor.scroll).toBe(1);
	});

	test("clamp clears the state for an empty list", () => {
		const cursor = new IdCursor();
		cursor.id = "a";
		cursor.scroll = 3;
		cursor.clamp([], rowKey);
		expect(cursor.id).toBeUndefined();
		expect(cursor.scroll).toBe(0);
	});

	test("select clamps the index, anchors the id, and keeps it visible", () => {
		const cursor = new IdCursor();
		cursor.visible = 2;
		cursor.select(items, rowKey, 99);
		expect(cursor.id).toBe("c");
		expect(cursor.scroll).toBe(1);
	});

	test("select ignores an empty list", () => {
		const cursor = new IdCursor();
		cursor.id = "a";
		cursor.select([], rowKey, 2);
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
	test("is the accent marker when selected and a same-width blank otherwise", () => {
		const selected = selectionMarker(fakeTheme, true);
		const blank = selectionMarker(fakeTheme, false);
		expect(selected).toContain("❯");
		expect(blank).not.toContain("❯");
		expect(visibleWidth(selected)).toBe(2);
		expect(visibleWidth(blank)).toBe(2);
	});
});

describe("formatRange", () => {
	test("renders a one-based showing row", () => {
		expect(formatRange(fakeTheme, 40, { start: 0, end: 3, total: 10 })).toContain("showing 1–3 of 10");
	});

	test("accepts a custom label for log panes", () => {
		expect(formatRange(fakeTheme, 40, { start: 1, end: 3, total: 10, label: "line" })).toContain("line 2–3 of 10");
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

describe("ConfirmState", () => {
	test("holds the question until it is answered", () => {
		const { state } = confirmHarness();
		expect(state.pending?.prompt).toBe("Kill j1? y/N");
	});

	test("accepts on y, Y, and Enter", () => {
		for (const key of ["y", "Y", "\r"]) {
			const { state, accepted } = confirmHarness();
			expect(state.resolve(key)).toBe("accept");
			expect(accepted).toEqual(["yes"]);
			expect(state.pending).toBeUndefined();
		}
	});

	test("dismisses on n, N, Escape, and q without acting", () => {
		for (const key of ["n", "N", "\x1b", "q"]) {
			const { state, accepted } = confirmHarness();
			expect(state.resolve(key)).toBe("dismiss");
			expect(accepted).toEqual([]);
			expect(state.pending).toBeUndefined();
		}
	});

	test("leaves any other key to the screen", () => {
		const { state, accepted } = confirmHarness();
		expect(state.resolve("j")).toBeUndefined();
		expect(state.pending?.prompt).toBe("Kill j1? y/N");
		expect(accepted).toEqual([]);
	});

	test("resolves nothing when no question is pending", () => {
		const state = new ConfirmState();
		expect(state.resolve("y")).toBeUndefined();
	});

	test("a later question replaces an earlier one", () => {
		const state = new ConfirmState();
		const accepted: string[] = [];
		state.ask("first? y/N", () => accepted.push("first"));
		state.ask("second? y/N", () => accepted.push("second"));
		state.resolve("y");
		expect(accepted).toEqual(["second"]);
	});

	test("clearing drops the question", () => {
		const { state, accepted } = confirmHarness();
		state.clear();
		expect(state.pending).toBeUndefined();
		expect(state.resolve("y")).toBeUndefined();
		expect(accepted).toEqual([]);
	});
});

describe("LinePane", () => {
	/** A pane sized two rows with three lines of `j1` output. */
	function jobPane(): LinePane {
		const value = new LinePane();
		value.visible = 2;
		value.open("j1", { title: "j1 build", lines: ["a", "b", "c"], subtitle: "/tmp/j1.log", more: true });
		return value;
	}

	test("open sets the id, title, and subtitle and parks at the tail", () => {
		const value = jobPane();
		expect(value.id).toBe("j1");
		expect(value.title("Job Logs")).toBe("Job Logs · j1 build");
		expect(value.count).toBe(3);
		expect(value.follow).toBe(true);
		expect(value.scroll).toBe(1);
	});

	test("title falls back to the prefix when the row has no title", () => {
		const value = new LinePane();
		value.open("x", { lines: [] });
		expect(value.title("Watch Matches")).toBe("Watch Matches");
	});

	test("update reports no change for an identical buffer", () => {
		const value = jobPane();
		const unchanged = value.update({
			title: "j1 build",
			lines: ["a", "b", "c"],
			subtitle: "/tmp/j1.log",
			more: true,
		});
		expect(unchanged).toBe(false);
	});

	test("update reports a change for new lines and follows the tail", () => {
		const value = jobPane();
		expect(value.update({ lines: ["a", "b", "c", "d"] })).toBe(true);
		expect(value.maxScroll).toBe(2);
		expect(value.scroll).toBe(2);
	});

	test("an omitted field is left alone", () => {
		const value = jobPane();
		value.update({ lines: ["a", "b", "c", "d"] });
		expect(value.subtitleLine()).toContain("/tmp/j1.log");
	});

	test("scrolling up clears follow and returning to the tail restores it", () => {
		const value = jobPane();
		value.setScroll(0);
		expect(value.follow).toBe(false);
		expect(value.subtitleLine()).toContain("paused");
		value.setScroll(value.maxScroll);
		expect(value.follow).toBe(true);
		expect(value.subtitleLine()).toContain("following");
	});

	test("window clamps to the buffer", () => {
		const value = jobPane();
		value.visible = 2;
		expect(value.window()).toEqual({ start: 1, end: 3 });
		value.setScroll(99);
		expect(value.window()).toEqual({ start: 1, end: 3 });
	});

	test("subtitleLine joins the source, the window note, and the follow state", () => {
		const value = jobPane();
		expect(value.subtitleLine()).toBe("/tmp/j1.log · showing last 3 lines · following");
	});

	test("subtitleLine is empty when there is nothing to say", () => {
		const value = new LinePane();
		value.open("x", { lines: [] });
		expect(value.subtitleLine()).toBe("");
	});

	test("handleKey consumes scroll keys and leaves the rest", () => {
		const value = jobPane();
		expect(value.handleKey(HOME)).toBe(true);
		expect(value.scroll).toBe(0);
		expect(value.handleKey(END)).toBe(true);
		expect(value.scroll).toBe(1);
		expect(value.handleKey(DOWN)).toBe(true);
		expect(value.handleKey(PAGE_DOWN)).toBe(true);
		expect(value.handleKey("g")).toBe(true);
		expect(value.scroll).toBe(0);
		expect(value.handleKey("d")).toBe(false);
	});

	test("fit adopts a new height, clamps, and re-parks a following view", () => {
		const value = jobPane();
		value.fit(1);
		expect(value.maxScroll).toBe(2);
		expect(value.scroll).toBe(2);
		value.setScroll(0);
		value.fit(3);
		expect(value.scroll).toBe(0);
		expect(value.follow).toBe(false);
	});

	test("close drops the buffer and the id", () => {
		const value = jobPane();
		value.close();
		expect(value.id).toBe("");
		expect(value.count).toBe(0);
		expect(value.scroll).toBe(0);
	});

	test("a non-tail pane opens at the top and never reports following", () => {
		const value = new LinePane();
		value.visible = 2;
		value.open("m1", { title: "integrator · event", lines: ["a", "b", "c"] }, false);
		expect(value.tail).toBe(false);
		expect(value.scroll).toBe(0);
		expect(value.follow).toBe(false);
		expect(value.subtitleLine()).not.toContain("following");
		value.setScroll(2);
		expect(value.subtitleLine()).not.toContain("paused");
		value.close();
		expect(value.tail).toBe(true);
	});
});

interface Row {
	id: string;
	label: string;
	active: boolean;
}

function sampleRows(): Row[] {
	return [
		{ id: "r1", label: "first", active: true },
		{ id: "r2", label: "second", active: false },
	];
}

class StubScreen extends DockListScreen<Row> {
	readonly verbs: string[] = [];
	private closed = false;
	private readonly detail: Record<string, string[]> = { r1: ["line one", "line two"], r2: ["other"] };

	constructor(
		private rows_: Row[],
		viewportRowsSource?: number,
	) {
		super({
			theme: fakeTheme,
			title: "Stub",
			detailTitle: "Stub Detail",
			emptyList: "Nothing here.",
			emptyDetail: "No lines yet.",
			requestRender: () => {},
			onClose: () => {
				this.closed = true;
			},
			viewportRowsSource,
		});
	}

	get didClose(): boolean {
		return this.closed;
	}

	/** Replace the rows, as a live source does under the cursor. */
	setRows(rows: Row[]): void {
		this.rows_ = rows;
	}

	/** Ask the base for a confirmation, as a real screen's verb does. */
	askToDelete(accept: () => void): void {
		this.confirm("Delete r1? y/N", accept);
	}

	/** Show one line of feedback, as a no-op verb does. */
	show(text: string): void {
		this.notify(text);
	}

	protected rows(): readonly Row[] {
		return this.rows_;
	}

	protected idOf(row: Row): string {
		return row.id;
	}

	protected rowLine(row: Row, width: number, selected: boolean): string {
		const marker = selected ? ">" : " ";
		return `${marker} ${row.label}`.slice(0, Math.max(1, width));
	}

	protected detailBlock(row: Row): string[] {
		return [`detail of ${row.id}`];
	}

	protected summaryCells(rows: readonly Row[]): string[] {
		return [`${rows.length} rows`, `${rows.filter((row) => row.active).length} active`];
	}

	protected listHints(): ScreenHint[] {
		return ["Esc close", "j/k select", "d delete"];
	}

	protected detailHints(): ScreenHint[] {
		return ["Esc back", "j/k scroll"];
	}

	protected detailFor(row: Row): DetailContents {
		return { title: `${row.id} ${row.label}`, lines: this.detail[row.id] ?? [] };
	}

	protected detailById(id: string): DetailSource | undefined {
		const lines = this.detail[id];
		return lines ? { lines } : undefined;
	}

	protected handleVerb(key: string, focused: Row | undefined): void {
		this.verbs.push(`${key}:${focused?.id ?? "none"}`);
	}
}

/**
 * Exercises the optional members a screen with more than a fixed body needs:
 * width-aware facts, a pane that re-reads its source, a verb inside the pane,
 * and hints that see the rows and the open row.
 */
class FeatureScreen extends DockListScreen<Row> {
	readonly verbs: string[] = [];
	readonly hintRows: number[] = [];
	readonly hintDetail: (string | undefined)[] = [];
	lines: Record<string, string[]> = { r1: ["first read"], r2: ["other"] };
	facts: string[] = [];

	constructor(
		private rows_: Row[],
		viewportRowsSource?: number,
	) {
		super({
			theme: fakeTheme,
			title: "Feature",
			detailTitle: "Feature Detail",
			emptyList: "Nothing here.",
			emptyDetail: "No lines yet.",
			requestRender: () => {},
			onClose: () => {},
			viewportRowsSource,
		});
	}

	setRows(rows: Row[]): void {
		this.rows_ = rows;
	}

	protected rows(): readonly Row[] {
		return this.rows_;
	}

	protected idOf(row: Row): string {
		return row.id;
	}

	protected rowLine(row: Row, width: number): string {
		return ` ${row.label}`.slice(0, Math.max(1, width));
	}

	protected detailBlock(): string[] {
		return [];
	}

	protected summaryCells(rows: readonly Row[]): string[] {
		return [`${rows.length} rows`];
	}

	protected listHints(rows: readonly Row[]): ScreenHint[] {
		this.hintRows.push(rows.length);
		return [`${rows.length} rows to pick`];
	}

	protected detailHints(row: Row | undefined): ScreenHint[] {
		this.hintDetail.push(row?.id);
		return ["Esc back"];
	}

	protected detailFor(row: Row): DetailContents {
		return {
			title: row.id,
			lines: this.lines[row.id] ?? [],
			facts: (width) => this.facts.map((fact) => fact.slice(0, width)),
		};
	}

	/** The source is the row itself, so a removed row is gone here too. */
	protected detailById(id: string): DetailSource | undefined {
		const row = this.rows().find((entry) => entry.id === id);
		return row ? { lines: this.lines[id] ?? [] } : undefined;
	}

	protected liveDetail(): boolean {
		return true;
	}

	protected handleDetailVerb(key: string, row: Row): boolean {
		this.verbs.push(`${key}:${row.id}`);
		if (key === "x") {
			this.confirm(`Stop ${row.id}? y/N`, () => this.verbs.push(`stop:${row.id}`));
			return true;
		}
		return key === "c";
	}

	protected handleVerb(): void {}
}

/**
 * A screen whose list is one of several scopes and whose pane is prose: it
 * exercises the header and empty-line hooks plus `DetailContents.text`/`tail`.
 */
class ProseScreen extends DockListScreen<Row> {
	private rows_: Row[];

	constructor(rows: Row[]) {
		super({
			theme: fakeTheme,
			title: "Sessions",
			detailTitle: "Detail",
			emptyList: "Nothing here.",
			emptyDetail: "No lines yet.",
			requestRender: () => {},
			onClose: () => {},
		});
		this.rows_ = rows;
	}

	setRows(rows: Row[]): void {
		this.rows_ = rows;
	}

	protected headerLabel(): string {
		return "Inbox";
	}

	protected emptyLabel(): string {
		return "No unread mail.";
	}

	protected rows(): readonly Row[] {
		return this.rows_;
	}

	protected idOf(row: Row): string {
		return row.id;
	}

	protected rowLine(row: Row, width: number): string {
		return ` ${row.label}`.slice(0, Math.max(1, width));
	}

	protected detailBlock(): string[] {
		return [];
	}

	protected summaryCells(rows: readonly Row[]): string[] {
		return [`${rows.length} rows`];
	}

	protected listHints(): ScreenHint[] {
		return ["Esc close"];
	}

	protected detailHints(): ScreenHint[] {
		return ["Esc back"];
	}

	protected detailFor(row: Row): DetailContents {
		if (row.id !== "r1") return { title: row.id, lines: ["plain line"] };
		return {
			title: "integrator · event",
			subtitle: "2m ago",
			tail: false,
			text: Array.from({ length: 12 }, () => "contract v2").join(" "),
		};
	}

	protected detailById(id: string): DetailSource | undefined {
		const row = this.rows().find((entry) => entry.id === id);
		if (!row) return undefined;
		return row.id === "r1" ? { lines: [] } : { lines: ["plain line"] };
	}

	protected liveDetail(): boolean {
		return true;
	}

	protected handleVerb(): void {}
}

function renderFrame(screen: { render(width: number): string[] }, width = 60): string[] {
	return screen.render(width);
}

describe("DockListScreen prose panes and scope labels", () => {
	test("names the header and the empty line through the hooks", () => {
		const screen = new ProseScreen(sampleRows());
		expect(renderFrame(screen)[0]).toContain("Inbox");
		screen.setRows([]);
		expect(renderFrame(screen).some((line) => line.includes("No unread mail."))).toBe(true);
	});

	test("wraps a prose body to the width, re-wraps on a resize, and never says following", () => {
		const screen = new ProseScreen(sampleRows());
		screen.handleInput("\r");
		const wide = renderFrame(screen, 80).filter((line) => line.includes("contract"));
		const narrow = renderFrame(screen, 40).filter((line) => line.includes("contract"));
		expect(narrow.length).toBeGreaterThan(wide.length);
		for (const width of [40, 80]) {
			for (const line of renderFrame(screen, width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		expect(renderFrame(screen, 80).join("\n")).not.toContain("following");
	});

	test("returns from prose to a line pane without stale text", () => {
		const screen = new ProseScreen(sampleRows());
		screen.handleInput("\r");
		expect(renderFrame(screen)[0]).toContain("integrator");
		screen.handleInput("\x1b");
		screen.handleInput("j");
		screen.handleInput("\r");
		expect(renderFrame(screen)[0]).toContain("r2");
		expect(renderFrame(screen).some((line) => line.includes("plain line"))).toBe(true);
		expect(renderFrame(screen).join("\n")).not.toContain("contract v2");
	});

	test("closes a prose pane when its row disappears", () => {
		const screen = new ProseScreen(sampleRows());
		screen.handleInput("\r");
		expect(renderFrame(screen)[0]).toContain("integrator");
		screen.setRows([]);
		const lines = renderFrame(screen);
		expect(lines[0]).toContain("Inbox");
		expect(lines.some((line) => line.includes("No unread mail."))).toBe(true);
	});
});

describe("DockListScreen", () => {
	test("does not answer Pi's focus check, so the host never assigns the flag", () => {
		// `isFocusable` is `"focused" in component`, and TUI then writes
		// `component.focused = true`: a read-only accessor under that name throws on
		// the way back to the editor. The screen's own selection is `focusedRow`.
		const screen = new StubScreen(sampleRows());
		expect("focused" in screen).toBe(false);
	});

	test("draws the title rule, the summary, the rows, a focus block, and the hint", () => {
		const lines = renderFrame(new StubScreen(sampleRows()));
		expect(lines[0]).toContain("Stub");
		expect(lines.some((line) => line.includes("2 rows"))).toBe(true);
		expect(lines.some((line) => line.includes("> first"))).toBe(true);
		expect(lines.some((line) => line.includes("detail of r1"))).toBe(true);
		expect(lines.some((line) => line.includes("Esc close"))).toBe(true);
	});

	test("draws an empty state instead of rows", () => {
		const lines = renderFrame(new StubScreen([]));
		expect(lines.some((line) => line.includes("Nothing here."))).toBe(true);
		expect(lines.some((line) => line.includes("0 rows"))).toBe(true);
	});

	test("moves the focus with j/k and keeps it on the same row after a re-sort", () => {
		const screen = new StubScreen(sampleRows());
		screen.handleInput("j");
		expect(renderFrame(screen).some((line) => line.includes("> second"))).toBe(true);
		// r2 finishes and sorts below r1: the focus must stay on r2, not on index 1.
		screen.setRows([
			{ id: "r3", label: "third", active: true },
			{ id: "r2", label: "second", active: false },
			{ id: "r1", label: "first", active: true },
		]);
		const lines = renderFrame(screen);
		expect(lines.some((line) => line.includes("> second"))).toBe(true);
		expect(lines.some((line) => line.includes("detail of r2"))).toBe(true);
	});

	test("opens a detail pane on Enter and returns on Escape", () => {
		const screen = new StubScreen(sampleRows());
		screen.handleInput("\r");
		const open = renderFrame(screen);
		expect(open[0]).toContain("Stub Detail · r1 first");
		expect(open.some((line) => line.includes("line one"))).toBe(true);
		screen.handleInput("\x1b");
		expect(renderFrame(screen)[0]).toContain("Stub");
	});

	test("shows the empty-detail state for a row with no lines", () => {
		const empty = new (class extends StubScreen {
			protected detailFor(row: Row): DetailContents {
				return { title: row.id, lines: [] };
			}
		})(sampleRows());
		empty.handleInput("\r");
		expect(renderFrame(empty).some((line) => line.includes("No lines yet."))).toBe(true);
	});

	test("delegates a list verb with the focused row", () => {
		const screen = new StubScreen(sampleRows());
		screen.handleInput("d");
		screen.handleInput("j");
		screen.handleInput("d");
		expect(screen.verbs).toEqual(["d:r1", "d:r2"]);
	});

	test("shows a confirmation and acts only on accept", () => {
		const screen = new StubScreen(sampleRows());
		let deleted = 0;
		screen.askToDelete(() => {
			deleted++;
		});
		expect(renderFrame(screen).some((line) => line.includes("Delete r1? y/N"))).toBe(true);
		// A navigation key is left alone while the question is up.
		screen.handleInput("j");
		expect(deleted).toBe(0);
		expect(renderFrame(screen).some((line) => line.includes("Delete r1? y/N"))).toBe(true);
		screen.handleInput("y");
		expect(deleted).toBe(1);
		expect(renderFrame(screen).some((line) => line.includes("Delete r1? y/N"))).toBe(false);
	});

	test("dismisses a confirmation without acting", () => {
		const screen = new StubScreen(sampleRows());
		let deleted = 0;
		screen.askToDelete(() => {
			deleted++;
		});
		screen.handleInput("n");
		expect(deleted).toBe(0);
		expect(renderFrame(screen).some((line) => line.includes("Delete r1? y/N"))).toBe(false);
	});

	test("shows feedback in place of the hints until the next key", () => {
		const screen = new StubScreen(sampleRows());
		screen.show("r1 already finished; nothing to kill.");
		expect(renderFrame(screen).some((line) => line.includes("nothing to kill"))).toBe(true);
		screen.handleInput("j");
		expect(renderFrame(screen).some((line) => line.includes("nothing to kill"))).toBe(false);
	});

	test("closes on Escape and q", () => {
		for (const key of ["\x1b", "q"]) {
			const screen = new StubScreen(sampleRows());
			screen.handleInput(key);
			expect(screen.didClose).toBe(true);
		}
	});

	test("keeps a range note when the rows exceed the viewport", () => {
		const many = Array.from({ length: 40 }, (_, index) => ({
			id: `r${index}`,
			label: `row ${index}`,
			active: true,
		}));
		const screen = new StubScreen(many, 14);
		const lines = renderFrame(screen);
		expect(lines.some((line) => /showing 1–\d+ of 40/.test(line))).toBe(true);
		// The wheel moves the focus, which scrolls the window to the last row.
		screen.handleMouse(wheelEvent(40));
		expect(renderFrame(screen).some((line) => /showing \d+–40 of 40/.test(line))).toBe(true);
	});

	test("moves the focus with the wheel in list mode", () => {
		const screen = new StubScreen(sampleRows());
		screen.handleMouse(wheelEvent(1));
		expect(renderFrame(screen).some((line) => line.includes("> second"))).toBe(true);
	});

	test("every line fits the width", () => {
		const screen = new StubScreen(sampleRows());
		for (const width of [12, 30, 80]) {
			for (const line of renderFrame(screen, width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		screen.handleInput("\r");
		for (const width of [12, 30, 80]) {
			for (const line of renderFrame(screen, width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});

describe("DockListScreen optional members", () => {
	test("draws width-aware facts above the body and counts them against the height", () => {
		const source = Array.from({ length: 40 }, (_, index) => `body ${index}`);
		const open = (facts: string[]): FeatureScreen => {
			const screen = new FeatureScreen(sampleRows(), 14);
			screen.lines = { r1: source };
			screen.facts = facts;
			screen.handleInput("\r");
			return screen;
		};

		const plain = open([]);
		const withFacts = open(["Task the auth module", "Cwd /repo", "Usage 2k"]);
		const bodyLines = (screen: FeatureScreen): number =>
			renderFrame(screen).filter((line) => line.includes("body ")).length;

		const lines = renderFrame(withFacts);
		for (const fact of ["Task", "Cwd", "Usage"]) {
			expect(lines.some((line) => line.includes(fact))).toBe(true);
		}
		// The facts sit above the body, and their rows come out of the pane's budget.
		const firstFact = lines.findIndex((line) => line.includes("Task"));
		const firstBody = lines.findIndex((line) => line.includes("body "));
		expect(firstFact).toBeGreaterThanOrEqual(0);
		expect(firstBody).toBeGreaterThan(firstFact);
		expect(bodyLines(withFacts)).toBeLessThan(bodyLines(plain));
	});

	test("re-reads a live pane on every frame", () => {
		const screen = new FeatureScreen(sampleRows());
		screen.handleInput("\r");
		expect(renderFrame(screen).some((line) => line.includes("first read"))).toBe(true);

		// No refresh call: a live screen's source is read while rendering.
		screen.lines = { r1: ["second read"] };
		const lines = renderFrame(screen);
		expect(lines.some((line) => line.includes("second read"))).toBe(true);
		expect(lines.some((line) => line.includes("first read"))).toBe(false);
	});

	test("returns to the list when a live row disappears", () => {
		const screen = new FeatureScreen(sampleRows());
		screen.handleInput("\r");
		expect(renderFrame(screen)[0]).toContain("Feature Detail");

		screen.setRows([]);
		const lines = renderFrame(screen);
		expect(lines[0]).toContain("Feature");
		expect(lines[0]).not.toContain("Detail");
		expect(lines.some((line) => line.includes("Nothing here."))).toBe(true);
	});

	test("offers a verb inside the pane and only consumes what it handles", () => {
		const screen = new FeatureScreen(sampleRows());
		screen.handleInput("\r");
		screen.handleInput("c");
		screen.handleInput("j");

		// The verb saw both keys; it claimed `c` and left `j` for the pane to scroll.
		expect(screen.verbs).toEqual(["c:r1", "j:r1"]);
	});

	test("shows a confirmation asked from inside the pane", () => {
		const screen = new FeatureScreen(sampleRows());
		screen.handleInput("\r");
		screen.handleInput("x");
		expect(renderFrame(screen).some((line) => line.includes("Stop r1? y/N"))).toBe(true);
		screen.handleInput("y");
		expect(screen.verbs).toContain("stop:r1");
		expect(renderFrame(screen).some((line) => line.includes("Stop r1? y/N"))).toBe(false);
	});

	test("passes the rows to the list hints and the open row to the detail hints", () => {
		const screen = new FeatureScreen(sampleRows());
		renderFrame(screen);
		expect(screen.hintRows.at(-1)).toBe(2);

		screen.handleInput("\r");
		renderFrame(screen);
		expect(screen.hintDetail.at(-1)).toBe("r1");
	});

	test("keeps a pane fixed between frames when it is not live", () => {
		// StubScreen has a pollable source but no live pane: its lines wait for the host.
		const screen = new StubScreen(sampleRows());
		screen.handleInput("\r");
		expect(renderFrame(screen)).toEqual(renderFrame(screen));
	});
});

interface RecordingUi {
	theme: unknown;
	setStatus(key: string, value: string | undefined): void;
	notify(text: string, severity: string): void;
}

/** A context whose UI records the statuses and notifications it is given. */
function statusContext(theme: unknown = fakeTheme): {
	target: ExtensionContext;
	statuses: Map<string, string | undefined>;
	notices: Array<{ text: string; severity: string }>;
} {
	const statuses = new Map<string, string | undefined>();
	const notices: Array<{ text: string; severity: string }> = [];
	const ui: RecordingUi = {
		theme,
		setStatus: (key, value) => {
			if (value === undefined) statuses.delete(key);
			else statuses.set(key, value);
		},
		notify: (text, severity) => {
			notices.push({ text, severity });
		},
	};
	return { target: { ui } as unknown as ExtensionContext, statuses, notices };
}

function statusChips(): StatusChip[] {
	return [
		{ key: "running", glyph: "▸", count: 2, role: "accent" },
		{ key: "failed", glyph: "✗", count: 0, role: "bad" },
	];
}

describe("createStatusController", () => {
	test("no-ops until a context is attached", () => {
		const controller = createStatusController({ keys: ["running", "failed"], enabled: () => true, chips: statusChips });
		expect(() => {
			controller.setStatus();
			controller.paint();
		}).not.toThrow();
	});

	test("publishes each chip and clears a zero count", () => {
		const { target, statuses } = statusContext();
		const controller = createStatusController({ keys: ["running", "failed"], enabled: () => true, chips: statusChips });
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("▸ 2");
		expect(statuses.has("failed")).toBe(false);
	});

	test("paints through the theme's role", () => {
		const { target, statuses } = statusContext(coloringTheme);
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("[accent]▸ 2");
	});

	test("an unavailable theme falls back to plain text", () => {
		const broken: Record<string, unknown> = {};
		broken.fg = () => {
			throw new Error("no theme");
		};
		const { target, statuses } = statusContext(broken);
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("▸ 2");
	});

	test("a disabled controller clears every key it owns", () => {
		const { target, statuses } = statusContext();
		let enabled = true;
		const controller = createStatusController({
			keys: ["running", "failed"],
			enabled: () => enabled,
			chips: statusChips,
		});
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("▸ 2");
		enabled = false;
		controller.paint();
		expect(statuses.has("running")).toBe(false);
		expect(statuses.has("failed")).toBe(false);
	});

	test("detach clears the keys it owns and stops publishing", () => {
		const { target, statuses } = statusContext();
		const controller = createStatusController({ keys: ["running", "failed"], enabled: () => true, chips: statusChips });
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("▸ 2");
		controller.detach();
		// A detached controller cannot repaint, so it must not leave a stale chip.
		expect(statuses.has("running")).toBe(false);
		controller.paint();
		expect(statuses.size).toBe(0);
	});

	test("detach survives a UI that is already gone", () => {
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		const broken = {
			ui: {
				theme: fakeTheme,
				setStatus: () => {
					throw new Error("gone");
				},
			},
		};
		controller.setStatus(broken as unknown as ExtensionContext);
		expect(() => controller.detach()).not.toThrow();
	});
});

describe("createStatusController notify", () => {
	test("routes a notification through the attached context", () => {
		const { target, notices } = statusContext();
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		controller.setStatus(target);
		controller.notify("Job j1 failed", "error");
		expect(notices).toEqual([{ text: "Job j1 failed", severity: "error" }]);
	});

	test("no-ops without a context, so a non-interactive mode needs no guard", () => {
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		expect(() => controller.notify("Job j1 failed", "error")).not.toThrow();
	});

	test("swallows a UI that throws", () => {
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		const broken = {
			ui: {
				theme: fakeTheme,
				notify: () => {
					throw new Error("gone");
				},
			},
		};
		controller.attach(broken as unknown as ExtensionContext);
		expect(() => controller.notify("Job j1 failed", "error")).not.toThrow();
	});

	test("stops notifying after detach", () => {
		const { target, notices } = statusContext();
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		controller.setStatus(target);
		controller.detach();
		controller.notify("Job j1 failed", "error");
		expect(notices).toEqual([]);
	});
});
