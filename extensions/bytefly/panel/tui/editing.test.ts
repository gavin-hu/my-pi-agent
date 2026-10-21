import { describe, expect, test } from "bun:test";
import { applyEditKey, type EditingState } from "./editing.ts";

const state = (buffer: string, caret = buffer.length): EditingState => ({ id: "notify.title", buffer, caret });

describe("applyEditKey", () => {
	test("Esc and Ctrl+C cancel and Enter commits", () => {
		expect(applyEditKey("\u001b", state("Pi"), 40)).toEqual({ kind: "cancel" });
		expect(applyEditKey("\u0003", state("Pi"), 40)).toEqual({ kind: "cancel" });
		expect(applyEditKey("\r", state("Pi"), 40)).toEqual({ kind: "commit" });
	});

	test("Backspace and Delete edit around the caret", () => {
		const middle = state("Pilot", 2);
		expect(applyEditKey("\u007f", middle, 40)).toEqual({
			kind: "update",
			state: { id: "notify.title", buffer: "Plot", caret: 1 },
			changed: true,
		});
		expect(applyEditKey("\u001b[3~", middle, 40)).toEqual({
			kind: "update",
			state: { id: "notify.title", buffer: "Piot", caret: 2 },
			changed: true,
		});
	});

	test("a Backspace at the start changes nothing", () => {
		expect(applyEditKey("\u007f", state("Pi", 0), 40)).toEqual({
			kind: "update",
			state: state("Pi", 0),
			changed: false,
		});
	});

	test("Left and Right clamp at the ends", () => {
		expect(applyEditKey("\u001b[D", state("Pi", 0), 40)).toEqual({
			kind: "update",
			state: state("Pi", 0),
			changed: false,
		});
		expect(applyEditKey("\u001b[C", state("Pi"), 40)).toEqual({ kind: "update", state: state("Pi"), changed: false });
		expect(applyEditKey("\u001b[D", state("Pi"), 40)).toEqual({
			kind: "update",
			state: state("Pi", 1),
			changed: true,
		});
	});

	test("Home/End and their Ctrl spellings move the caret", () => {
		for (const key of ["\u001b[H", "\u0001"]) {
			expect(applyEditKey(key, state("Pi"), 40)).toEqual({ kind: "update", state: state("Pi", 0), changed: true });
		}
		for (const key of ["\u001b[F", "\u0005"]) {
			expect(applyEditKey(key, state("Pi", 0), 40)).toEqual({ kind: "update", state: state("Pi"), changed: true });
		}
	});

	test("Ctrl+U clears the buffer", () => {
		expect(applyEditKey("\u0015", state("Pi"), 40)).toEqual({
			kind: "update",
			state: { id: "notify.title", buffer: "", caret: 0 },
			changed: true,
		});
	});

	test("inserts a printable character at the caret", () => {
		expect(applyEditKey("x", state("Pi", 1), 40)).toEqual({
			kind: "update",
			state: { id: "notify.title", buffer: "Pxi", caret: 2 },
			changed: true,
		});
	});

	test("strips bracketed-paste markers", () => {
		expect(applyEditKey("\x1b[200~Build finished\x1b[201~", state("Pi"), 40)).toEqual({
			kind: "update",
			state: state("PiBuild finished"),
			changed: true,
		});
	});

	test("refuses control characters", () => {
		expect(applyEditKey("\u0007", state("Pi"), 40)).toEqual({ kind: "update", state: state("Pi"), changed: false });
	});

	test("refuses typed text past the row's limit", () => {
		expect(applyEditKey("t", state("Pi"), 2)).toEqual({ kind: "update", state: state("Pi"), changed: false });
		expect(applyEditKey("t", state("Pi"), 3)).toEqual({
			kind: "update",
			state: state("Pit"),
			changed: true,
		});
	});

	test("refuses text on a row with no text rule", () => {
		expect(applyEditKey("x", state("Pi"), undefined)).toEqual({ kind: "update", state: state("Pi"), changed: false });
	});
});
