import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { makeFinding, makeReport } from "../../test/helpers/fixtures/doctor.ts";
import { DoctorScreen } from "./tui.ts";

/** A screen over a fixed report set, with its callbacks recorded. */
function screen(
	reports = [
		makeReport("document", [makeFinding("pdfcraft-cli", "missing", "not found on PATH", "cargo install ...")]),
		makeReport("todo", [makeFinding("todo.json", "ok")]),
		makeReport("status-bar", [makeFinding("platform", "info", "TUI only")]),
	],
) {
	const calls = { render: 0, refresh: 0, done: 0 };
	const component = new DoctorScreen({
		reports: () => reports,
		rows: () => 24,
		theme: fakeTheme,
		requestRender: () => {
			calls.render += 1;
		},
		refresh: () => {
			calls.refresh += 1;
		},
		done: () => {
			calls.done += 1;
		},
	});
	return { component, calls, reports };
}

describe("DoctorScreen", () => {
	test("renders a header, one row per extension, and a hint row", () => {
		const { component } = screen();
		const lines = component.render(60);
		expect(lines[0]).toContain("doctor");
		expect(lines.join("\n")).toContain("document");
		expect(lines.join("\n")).toContain("todo");
		expect(lines.join("\n")).toContain("status-bar");
		expect(lines.at(-1)).toContain("Esc close");
	});

	test("keeps every line inside the width, even when narrow", () => {
		for (const width of [14, 24, 40, 100]) {
			const { component } = screen();
			for (const line of component.render(width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("shows the focused extension's findings in the detail pane", () => {
		const { component } = screen();
		expect(component.render(70).join("\n")).toContain("pdfcraft-cli");
		component.handleInput("j");
		expect(component.render(70).join("\n")).toContain("todo.json");
	});

	test("moves the selection with vim and arrow keys", () => {
		const { component, calls } = screen();
		component.handleInput("j");
		expect(calls.render).toBe(1);
		component.handleInput("k");
		expect(calls.render).toBe(2);
	});

	test("closes on escape", () => {
		const { component, calls } = screen();
		component.handleInput("\u001b");
		expect(calls.done).toBe(1);
	});

	test("re-probes on r", () => {
		const { component, calls } = screen();
		component.handleInput("r");
		expect(calls.refresh).toBe(1);
	});

	test("toggles between problems-only and every check on enter", () => {
		const { component } = screen([makeReport("status-bar", [makeFinding("platform", "info", "TUI only")])]);
		expect(component.render(60).join("\n")).not.toContain("TUI only");
		component.handleInput("\r");
		expect(component.render(60).join("\n")).toContain("TUI only");
	});

	test("scrolls with the mouse wheel", () => {
		const { component } = screen();
		const before = component.render(60).join("\n");
		const handled = component.handleMouse({ type: "wheel", wheelDelta: 1 } as never);
		expect(handled).toEqual({ handled: true });
		expect(component.render(60).join("\n")).not.toBe(before);
	});

	test("sanitizes report text before it reaches the terminal", () => {
		const { component } = screen([
			makeReport("document", [makeFinding("pdfcraft-cli", "missing", "bad\u001b[31mtext")]),
		]);
		expect(component.render(70).join("\n")).not.toContain("\u001b");
	});

	test("says so when there is nothing to report", () => {
		const { component } = screen([]);
		expect(component.render(60).join("\n")).toContain("no extensions to report");
	});
});
