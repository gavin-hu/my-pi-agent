/**
 * Who a picker may touch: an untrusted project is read-only, and the screen says so.
 *
 * Its own suite because `memory-picker.test.ts` is at its line bar, and these cases are about
 * the trust gate rather than about rendering one list.
 */

import { describe, expect, test } from "bun:test";
import { fakeTheme as theme } from "../../../test/helpers/fakes.ts";
import { notesOf } from "../../../test/helpers/fixtures/memory.ts";
import type { MemoryEntries } from "../format.ts";
import { MemoryPickerComponent } from "./memory-picker.ts";

const tui = { requestRender: () => {}, terminal: { rows: 24, columns: 80 } } as any;

/** The screen over one store, rendered as text, with its store returning a copy each read. */
function picker(project: string[], global: string[], trusted: boolean) {
	const entries: MemoryEntries = { project: notesOf(project), global: notesOf(global) };
	const component = new MemoryPickerComponent(
		tui,
		theme,
		{
			entries: () => ({ project: [...entries.project], global: [...entries.global] }),
			trusted: () => trusted,
			refresh: () => false,
			add: async () => ({ changed: true }),
			update: async () => true,
			forget: async () => true,
			merge: async () => true,
			move: async () => ({ moved: true }),
		},
		() => {},
		() => {},
		() => tui.terminal?.rows,
	);
	return {
		text: () => component.render(70).join("\n"),
		input: (data: string) => component.handleInput(data),
	};
}

describe("MemoryPickerComponent trust", () => {
	test("hides project notes and targets global when untrusted", () => {
		const h = picker(["secret"], ["ok"], false);

		expect(h.text()).not.toContain("secret");
		expect(h.text()).toContain("ok");
		expect(h.text()).toContain("project untrusted");
	});

	test("adds to global when untrusted", () => {
		const h = picker([], [], false);

		h.input("a");

		expect(h.text()).toContain("Add global");
	});

	test("skips the project scope when cycling the filter untrusted", () => {
		const h = picker([], ["ok"], false);

		h.input("s");

		expect(h.text()).toContain("global · ok");
	});
});
