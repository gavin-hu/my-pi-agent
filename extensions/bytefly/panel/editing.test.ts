/**
 * The value editor: the inline text row's key map, and the same editor driven
 * through `PanelComponent` — caret, clear, commit, cancel, and the runtime's
 * refusals.
 */

import { describe, expect, test } from "bun:test";
import { buildPanel, focusPanel, selectedLine } from "../../../test/helpers/fixtures/panel.ts";
import { fakeSettingsSurface } from "../../../test/helpers/fixtures/settings.ts";
import { settle } from "../../../test/helpers/process.ts";
import { type SettingsSurface } from "./settings-runtime.ts";
import { applyEditKey, type EditingState } from "./tui/editing.ts";

describe("panel text editing", () => {
	const state = (buffer: string, caret = buffer.length): EditingState => ({ id: "price.budget", buffer, caret });

	test("Esc and Ctrl+C cancel and Enter commits", () => {
		expect(applyEditKey("\u001b", state("Pi"), 40)).toEqual({ kind: "cancel" });
		expect(applyEditKey("\u0003", state("Pi"), 40)).toEqual({ kind: "cancel" });
		expect(applyEditKey("\r", state("Pi"), 40)).toEqual({ kind: "commit" });
	});

	test("Backspace and Delete edit around the caret", () => {
		const middle = state("Pilot", 2);
		expect(applyEditKey("\u007f", middle, 40)).toEqual({
			kind: "update",
			state: { id: "price.budget", buffer: "Plot", caret: 1 },
			changed: true,
		});
		expect(applyEditKey("\u001b[3~", middle, 40)).toEqual({
			kind: "update",
			state: { id: "price.budget", buffer: "Piot", caret: 2 },
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
			state: { id: "price.budget", buffer: "", caret: 0 },
			changed: true,
		});
	});

	test("inserts a printable character at the caret", () => {
		expect(applyEditKey("x", state("Pi", 1), 40)).toEqual({
			kind: "update",
			state: { id: "price.budget", buffer: "Pxi", caret: 2 },
			changed: true,
		});
	});

	test("strips bracketed-paste markers", () => {
		expect(applyEditKey("\x1b[200~4.5\x1b[201~", state("Pi"), 40)).toEqual({
			kind: "update",
			state: state("Pi4.5"),
			changed: true,
		});
	});

	test("refuses control characters and text past the row's limit", () => {
		expect(applyEditKey("\u0007", state("Pi"), 40)).toEqual({ kind: "update", state: state("Pi"), changed: false });
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

describe("PanelComponent text editing", () => {
	test("opens the editor on the only text row", () => {
		const { component } = buildPanel({ items: [], section: "settings", globalDoc: { price: { budget: 5 } } });

		focusPanel(component, "Session budget");
		component.handleInput(" ");

		const text = component.render(80).join("\n");
		expect(text).toContain("5▏");
		expect(selectedLine(component)).toContain("5▏");
	});

	test("Enter opens the editor on the stored value, with the caret at its end", () => {
		const { component } = buildPanel({ items: [], section: "settings", globalDoc: { price: { budget: 5 } } });

		focusPanel(component, "Session budget");
		component.handleInput("\r");

		const text = component.render(80).join("\n");
		expect(text).toContain("5▏");
		expect(text).toContain("About");
		expect(selectedLine(component)).toContain("5▏");
	});

	test("typing and Enter store the value", async () => {
		const settings = fakeSettingsSurface({ global: { price: { budget: 0 } } });
		const { component } = buildPanel({ items: [], section: "settings", settings: settings.surface });

		focusPanel(component, "Session budget");
		component.handleInput("\r");
		component.handleInput("\u0015");
		component.handleInput("5");
		component.handleInput("\r");
		await settle();
		await settle();

		expect(settings.changes).toContain("global:price.budget=5");
		expect(component.render(80).join("\n")).toContain("unsaved changes");
		expect(selectedLine(component)).toContain("¥5.00");
		// The block names the reload the change asks for once it has the height for it.
		expect(component.render(120).join("\n")).toContain("Saved · reload to apply");
	});

	test("Esc cancels without writing", async () => {
		const settings = fakeSettingsSurface({ global: { price: { budget: 0 } } });
		const { component } = buildPanel({ items: [], section: "settings", settings: settings.surface });

		focusPanel(component, "Session budget");
		component.handleInput("\r");
		component.handleInput("9");
		component.handleInput("\u001b");
		await settle();

		expect(settings.changes.filter((change) => change.includes("price.budget"))).toEqual([]);
		expect(component.render(80).join("\n")).not.toContain("9▏");
	});

	test("keeps the editor open when the runtime refuses the value", async () => {
		const base = fakeSettingsSurface({ global: { price: { budget: 0 } } });
		const refusing: SettingsSurface = { ...base.surface, setValue: async () => false };
		const { component } = buildPanel({ items: [], section: "settings", settings: refusing });

		focusPanel(component, "Session budget");
		component.handleInput("\r");
		component.handleInput("9");
		component.handleInput("\r");
		await settle();
		await settle();

		expect(component.render(80).join("\n")).toContain("9▏");
	});

	test("inserts at the caret and refuses characters past the limit", () => {
		const { component } = buildPanel({ items: [], section: "settings", globalDoc: { price: { budget: 12 } } });

		focusPanel(component, "Session budget");
		component.handleInput("\r");
		component.handleInput("\u001b[D");
		component.handleInput("3");
		expect(component.render(80).join("\n")).toContain("13▏2");

		component.handleInput("\u0005");
		for (let step = 0; step < 20; step += 1) component.handleInput("9");
		const text = component.render(80).join("\n");
		expect(text).toContain("132");
		expect(text).not.toContain("9".repeat(14));
	});

	test("strips bracketed-paste markers from a pasted value", async () => {
		const settings = fakeSettingsSurface({ global: { price: { budget: 0 } } });
		const { component } = buildPanel({ items: [], section: "settings", settings: settings.surface });

		focusPanel(component, "Session budget");
		component.handleInput("\r");
		component.handleInput("\u0015");
		component.handleInput("\x1b[200~4.5\x1b[201~");

		const text = component.render(80).join("\n");
		expect(text).toContain("4.5▏");
		expect(text).not.toContain("[200~");

		component.handleInput("\r");
		await settle();
		await settle();
		expect(settings.changes).toContain("global:price.budget=4.5");
	});
});
