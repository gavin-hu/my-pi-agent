import { describe, expect, test } from "bun:test";
import { LinePane } from "./line-pane.ts";

const DOWN = "\x1b[B";
const PAGE_DOWN = "\x1b[6~";
const HOME = "\x1b[H";
const END = "\x1b[F";

/** A pane sized two rows with three lines of `j1` output. */
function pane(): LinePane {
	const value = new LinePane();
	value.visible = 2;
	value.open("j1", { title: "j1 build", lines: ["a", "b", "c"], subtitle: "/tmp/j1.log", more: true });
	return value;
}

describe("LinePane", () => {
	test("open sets the id, title, and subtitle and parks at the tail", () => {
		const value = pane();
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
		const value = pane();
		const unchanged = value.update({
			title: "j1 build",
			lines: ["a", "b", "c"],
			subtitle: "/tmp/j1.log",
			more: true,
		});
		expect(unchanged).toBe(false);
	});

	test("update reports a change for new lines and follows the tail", () => {
		const value = pane();
		expect(value.update({ lines: ["a", "b", "c", "d"] })).toBe(true);
		expect(value.maxScroll).toBe(2);
		expect(value.scroll).toBe(2);
	});

	test("an omitted field is left alone", () => {
		const value = pane();
		value.update({ lines: ["a", "b", "c", "d"] });
		expect(value.subtitleLine()).toContain("/tmp/j1.log");
	});

	test("scrolling up clears follow and returning to the tail restores it", () => {
		const value = pane();
		value.setScroll(0);
		expect(value.follow).toBe(false);
		expect(value.subtitleLine()).toContain("paused");
		value.setScroll(value.maxScroll);
		expect(value.follow).toBe(true);
		expect(value.subtitleLine()).toContain("following");
	});

	test("window clamps to the buffer", () => {
		const value = pane();
		value.visible = 2;
		expect(value.window()).toEqual({ start: 1, end: 3 });
		value.setScroll(99);
		expect(value.window()).toEqual({ start: 1, end: 3 });
	});

	test("subtitleLine joins the source, the window note, and the follow state", () => {
		const value = pane();
		expect(value.subtitleLine()).toBe("/tmp/j1.log · showing last 3 lines · following");
	});

	test("subtitleLine is empty when there is nothing to say", () => {
		const value = new LinePane();
		value.open("x", { lines: [] });
		expect(value.subtitleLine()).toBe("");
	});

	test("handleKey consumes scroll keys and leaves the rest", () => {
		const value = pane();
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
		const value = pane();
		value.fit(1);
		expect(value.maxScroll).toBe(2);
		expect(value.scroll).toBe(2);
		value.setScroll(0);
		value.fit(3);
		expect(value.scroll).toBe(0);
		expect(value.follow).toBe(false);
	});

	test("close drops the buffer and the id", () => {
		const value = pane();
		value.close();
		expect(value.id).toBe("");
		expect(value.count).toBe(0);
		expect(value.scroll).toBe(0);
	});
});
