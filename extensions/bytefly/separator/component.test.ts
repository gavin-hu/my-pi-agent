import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { SeparatorComponent } from "./component.ts";
import { separatorLine } from "./format.ts";

describe("SeparatorComponent", () => {
	test("renders the separator line for its width and pad", () => {
		const component = new SeparatorComponent({ turn: 3 }, fakeTheme, 1);
		expect(component.render(41)).toEqual(separatorLine({ turn: 3 }, 41, fakeTheme, 1));
	});

	test("serves a repeat frame from its memo", () => {
		const component = new SeparatorComponent({ turn: 2 }, coloringTheme, 0);
		expect(component.render(40)).toBe(component.render(40));
		// A width change is a different layout, so it must rebuild.
		expect(component.render(41)).not.toBe(component.render(40));
	});

	test("drops the memo when the host invalidates it", () => {
		const component = new SeparatorComponent({ turn: 2 }, coloringTheme, 0);
		const first = component.render(40);
		component.invalidate();
		expect(component.render(40)).not.toBe(first);
		expect(component.render(40).join("\n")).toBe(first.join("\n"));
	});

	test("keeps every memoized line inside the width", () => {
		const component = new SeparatorComponent({ turn: 42 }, fakeTheme, 2);
		for (const width of [1, 5, 20, 80]) {
			for (const line of component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});
