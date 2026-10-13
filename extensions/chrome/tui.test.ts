import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { ChromeHeader, createEditor, createHeader, decorateTopBorder, type HeaderView } from "./tui.ts";

/** A header view with overrides, so each test states only what it exercises. */
const view = (overrides: Partial<HeaderView> = {}): HeaderView => ({
	mark: "wordmark",
	showVersion: true,
	showHints: false,
	...overrides,
});

/** A minimal `KeybindingsManager` double: every action resolves to one key. */
const keybindings = (keys: string[]): any => ({ getKeys: () => keys });

function header(viewValue: HeaderView, manager: any = undefined, version = "1.2.0"): ChromeHeader {
	return new ChromeHeader(
		() => fakeTheme,
		() => viewValue,
		() => manager,
		version,
	);
}

describe("decorateTopBorder", () => {
	test("splices the badge immediately before the top-right corner", () => {
		const base = `┌${"─".repeat(10)}┐`;

		expect(decorateTopBorder(base, " X ", 12)).toBe(`┌─────── X ┐`);
	});

	test("returns the base unchanged when the badge cannot fit", () => {
		const base = "┌──┐";

		expect(decorateTopBorder(base, " X ", 3)).toBe(base);
	});

	test("returns the base unchanged without a badge", () => {
		const base = `┌${"─".repeat(10)}┐`;

		expect(decorateTopBorder(base, undefined, 12)).toBe(base);
	});

	test("never exceeds the requested width", () => {
		const base = `┌${"─".repeat(20)}┐`;

		expect(visibleWidth(decorateTopBorder(base, " ⋮ high ", 22))).toBe(22);
	});
});

describe("ChromeHeader", () => {
	test("renders a blank line then the wordmark and version", () => {
		const lines = header(view()).render(80);

		expect(lines).toEqual(["", "Pi v1.2.0"]);
	});

	test("renders only the version when the mark is none", () => {
		expect(header(view({ mark: "none" })).render(80)).toEqual(["", "v1.2.0"]);
	});

	test("renders the two-line mark above the version", () => {
		expect(header(view({ mark: "logo" })).render(80)).toEqual(["", "█▀█ ", "█▀ █", "Pi v1.2.0"]);
	});

	test("omits the version when disabled", () => {
		expect(header(view({ showVersion: false })).render(80)).toEqual(["", "Pi"]);
	});

	test("right-aligns the hint row when keybindings are available", () => {
		const lines = header(view({ showHints: true }), keybindings(["ctrl+l"])).render(80);

		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain("ctrl+l model");
		expect(visibleWidth(lines[1]!)).toBe(80);
	});

	test("omits the hint row without keybindings", () => {
		expect(header(view({ showHints: true })).render(80)).toEqual(["", "Pi v1.2.0"]);
	});

	test("drops the hint row before shedding the version", () => {
		const lines = header(view({ showHints: true }), keybindings(["ctrl+l"])).render(14);

		expect(lines[1]).toBe("Pi v1.2.0");
	});

	test("sheds the version before truncating the mark", () => {
		expect(header(view()).render(5)).toEqual(["", "Pi"]);
	});

	test("every line fits the requested width", () => {
		for (const width of [1, 2, 4, 8, 20, 40, 80]) {
			for (const mark of ["wordmark", "logo", "none"] as const) {
				for (const line of header(view({ mark, showHints: true }), keybindings(["ctrl+l"])).render(width)) {
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				}
			}
		}
	});

	test("carries no session or model data", () => {
		const text = header(view()).render(80).join("\n");

		expect(text).not.toContain("feature");
		expect(text).not.toContain("opus");
	});
});

describe("chrome factories", () => {
	test("createHeader returns a factory that builds a component", () => {
		const factory = createHeader(
			() => fakeTheme,
			() => view(),
			() => undefined,
		);

		expect(typeof factory).toBe("function");
		expect(factory({ requestRender: () => {} } as any, fakeTheme).render(80)).toHaveLength(2);
	});

	test("createEditor returns a factory", () => {
		const factory = createEditor(
			() => fakeTheme,
			() => true,
			() => undefined,
		);

		expect(typeof factory).toBe("function");
	});
});
