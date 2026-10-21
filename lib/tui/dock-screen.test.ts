/**
 * The docked list screen's shared body: the frame, the id-anchored cursor, the
 * confirm layer, the feedback line, and the detail pane.
 *
 * A stub subclass supplies only the vocabulary, which is exactly the split the
 * base class promises — so these tests double as the contract a real screen
 * (`/jobs`, `/watch`) relies on.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import type { ScreenHint } from "./chrome.ts";
import { DockListScreen, type DetailContents, type DetailSource } from "./dock-screen.ts";

interface Row {
	id: string;
	label: string;
	active: boolean;
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
		return key === "c";
	}

	protected handleVerb(): void {}
}

const rows = (): Row[] => [
	{ id: "r1", label: "first", active: true },
	{ id: "r2", label: "second", active: false },
];

function frame(screen: { render(width: number): string[] }, width = 60): string[] {
	return screen.render(width);
}

describe("DockListScreen", () => {
	test("does not answer Pi's focus check, so the host never assigns the flag", () => {
		// `isFocusable` is `"focused" in component`, and TUI then writes
		// `component.focused = true`: a read-only accessor under that name throws on
		// the way back to the editor. The screen's own selection is `focusedRow`.
		const screen = new StubScreen(rows());
		expect("focused" in screen).toBe(false);
	});

	test("draws the title rule, the summary, the rows, a focus block, and the hint", () => {
		const screen = new StubScreen(rows());
		const lines = frame(screen);
		expect(lines[0]).toContain("Stub");
		expect(lines.some((line) => line.includes("2 rows"))).toBe(true);
		expect(lines.some((line) => line.includes("> first"))).toBe(true);
		expect(lines.some((line) => line.includes("detail of r1"))).toBe(true);
		expect(lines.some((line) => line.includes("Esc close"))).toBe(true);
	});

	test("draws an empty state instead of rows", () => {
		const screen = new StubScreen([]);
		const lines = frame(screen);
		expect(lines.some((line) => line.includes("Nothing here."))).toBe(true);
		expect(lines.some((line) => line.includes("0 rows"))).toBe(true);
	});

	test("moves the focus with j/k and keeps it on the same row after a re-sort", () => {
		const screen = new StubScreen(rows());
		screen.handleInput("j");
		expect(frame(screen).some((line) => line.includes("> second"))).toBe(true);
		// r2 finishes and sorts below r1: the focus must stay on r2, not on index 1.
		screen.setRows([
			{ id: "r3", label: "third", active: true },
			{ id: "r2", label: "second", active: false },
			{ id: "r1", label: "first", active: true },
		]);
		const lines = frame(screen);
		expect(lines.some((line) => line.includes("> second"))).toBe(true);
		expect(lines.some((line) => line.includes("detail of r2"))).toBe(true);
	});

	test("opens a detail pane on Enter and returns on Escape", () => {
		const screen = new StubScreen(rows());
		screen.handleInput("\r");
		const open = frame(screen);
		expect(open[0]).toContain("Stub Detail · r1 first");
		expect(open.some((line) => line.includes("line one"))).toBe(true);
		screen.handleInput("\x1b");
		expect(frame(screen)[0]).toContain("Stub");
	});

	test("shows the empty-detail state for a row with no lines", () => {
		const empty = new (class extends StubScreen {
			protected detailFor(row: Row): DetailContents {
				return { title: row.id, lines: [] };
			}
		})(rows());
		empty.handleInput("\r");
		expect(frame(empty).some((line) => line.includes("No lines yet."))).toBe(true);
	});

	test("delegates a list verb with the focused row", () => {
		const screen = new StubScreen(rows());
		screen.handleInput("d");
		screen.handleInput("j");
		screen.handleInput("d");
		expect(screen.verbs).toEqual(["d:r1", "d:r2"]);
	});

	test("shows a confirmation and acts only on accept", () => {
		const screen = new StubScreen(rows());
		let deleted = 0;
		screen.askToDelete(() => {
			deleted++;
		});
		expect(frame(screen).some((line) => line.includes("Delete r1? y/N"))).toBe(true);
		// A navigation key is left alone while the question is up.
		screen.handleInput("j");
		expect(deleted).toBe(0);
		expect(frame(screen).some((line) => line.includes("Delete r1? y/N"))).toBe(true);
		screen.handleInput("y");
		expect(deleted).toBe(1);
		expect(frame(screen).some((line) => line.includes("Delete r1? y/N"))).toBe(false);
	});

	test("dismisses a confirmation without acting", () => {
		const screen = new StubScreen(rows());
		let deleted = 0;
		screen.askToDelete(() => {
			deleted++;
		});
		screen.handleInput("n");
		expect(deleted).toBe(0);
		expect(frame(screen).some((line) => line.includes("Delete r1? y/N"))).toBe(false);
	});

	test("shows feedback in place of the hints until the next key", () => {
		const screen = new StubScreen(rows());
		screen.show("r1 already finished; nothing to kill.");
		expect(frame(screen).some((line) => line.includes("nothing to kill"))).toBe(true);
		screen.handleInput("j");
		expect(frame(screen).some((line) => line.includes("nothing to kill"))).toBe(false);
	});

	test("closes on Escape and q", () => {
		for (const key of ["\x1b", "q"]) {
			const screen = new StubScreen(rows());
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
		const lines = frame(screen);
		expect(lines.some((line) => /showing 1–\d+ of 40/.test(line))).toBe(true);
		// The wheel moves the focus, which scrolls the window to the last row.
		screen.handleMouse({ type: "wheel", wheelDelta: 40 } as never);
		expect(frame(screen).some((line) => /showing \d+–40 of 40/.test(line))).toBe(true);
	});

	test("moves the focus with the wheel in list mode", () => {
		const screen = new StubScreen(rows());
		screen.handleMouse({ type: "wheel", wheelDelta: 1 } as never);
		expect(frame(screen).some((line) => line.includes("> second"))).toBe(true);
	});

	test("every line fits the width", () => {
		const screen = new StubScreen(rows());
		for (const width of [12, 30, 80]) {
			for (const line of frame(screen, width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		screen.handleInput("\r");
		for (const width of [12, 30, 80]) {
			for (const line of frame(screen, width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});

describe("DockListScreen optional members", () => {
	test("draws width-aware facts above the body and counts them against the height", () => {
		const source = Array.from({ length: 40 }, (_, index) => `body ${index}`);
		const open = (facts: string[]): FeatureScreen => {
			const screen = new FeatureScreen(rows(), 14);
			screen.lines = { r1: source };
			screen.facts = facts;
			screen.handleInput("\r");
			return screen;
		};

		const plain = open([]);
		const withFacts = open(["Task  the auth module", "Cwd   /repo", "Usage  2k"]);
		const bodyLines = (screen: FeatureScreen): number => frame(screen).filter((line) => line.includes("body ")).length;

		const lines = frame(withFacts);
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
		const screen = new FeatureScreen(rows());
		screen.handleInput("\r");
		expect(frame(screen).some((line) => line.includes("first read"))).toBe(true);

		// No refresh call: a live screen's source is read while rendering.
		screen.lines = { r1: ["second read"] };
		const lines = frame(screen);
		expect(lines.some((line) => line.includes("second read"))).toBe(true);
		expect(lines.some((line) => line.includes("first read"))).toBe(false);
	});

	test("returns to the list when a live row disappears", () => {
		const screen = new FeatureScreen(rows());
		screen.handleInput("\r");
		expect(frame(screen)[0]).toContain("Feature Detail");

		screen.setRows([]);
		const lines = frame(screen);
		expect(lines[0]).toContain("Feature");
		expect(lines[0]).not.toContain("Detail");
		expect(lines.some((line) => line.includes("Nothing here."))).toBe(true);
	});

	test("offers a verb inside the pane and only consumes what it handles", () => {
		const screen = new FeatureScreen(rows());
		screen.handleInput("\r");
		screen.handleInput("c");
		screen.handleInput("j");

		// The verb saw both keys; it claimed `c` and left `j` for the pane to scroll.
		expect(screen.verbs).toEqual(["c:r1", "j:r1"]);
	});

	test("passes the rows to the list hints and the open row to the detail hints", () => {
		const screen = new FeatureScreen(rows());
		frame(screen);
		expect(screen.hintRows.at(-1)).toBe(2);

		screen.handleInput("\r");
		frame(screen);
		expect(screen.hintDetail.at(-1)).toBe("r1");
	});

	test("keeps a pane fixed between frames when it is not live", () => {
		// StubScreen has a pollable source but no live pane: its lines wait for the host.
		const screen = new StubScreen(rows());
		screen.handleInput("\r");
		expect(frame(screen)).toEqual(frame(screen));
	});
});
