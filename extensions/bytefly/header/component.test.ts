import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { ByteflyHeader, createHeader, type HeaderView } from "./component.ts";

/** A view with overrides, so each test states only what it exercises. */
const view = (overrides: Partial<HeaderView> = {}): HeaderView => ({
	mark: "wordmark",
	showVersion: true,
	...overrides,
});

function header(viewValue: HeaderView = view(), version = "1.2.0"): ByteflyHeader {
	return new ByteflyHeader(
		() => fakeTheme,
		() => viewValue,
		version,
	);
}

describe("ByteflyHeader", () => {
	test("renders the wordmark and version", () => {
		expect(header().render(80)).toEqual([" Pi v1.2.0"]);
	});

	test("renders only the version when the mark is none", () => {
		expect(header(view({ mark: "none" })).render(80)).toEqual([" v1.2.0"]);
	});

	test("omits the version when disabled", () => {
		expect(header(view({ showVersion: false })).render(80)).toEqual([" Pi"]);
	});

	test("renders the two-line mark with the version on its first line", () => {
		expect(header(view({ mark: "logo" })).render(80)).toEqual([" █▀█ v1.2.0", " █▀ █"]);
	});

	test("sheds the version before truncating the mark", () => {
		expect(header().render(5)).toEqual([" Pi"]);
		expect(header(view({ mark: "logo" })).render(5)).toEqual([" █▀█ ", " █▀ █"]);
	});

	test("every line fits the requested width", () => {
		for (const width of [1, 2, 4, 8, 20, 40, 80]) {
			for (const mark of ["wordmark", "logo", "none"] as const) {
				for (const line of header(view({ mark })).render(width)) {
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				}
			}
		}
	});

	test("colors the mark and version from the active theme", () => {
		const component = new ByteflyHeader(
			() => coloringTheme,
			() => view(),
			"1.2.0",
		);

		expect(component.render(80)[0]).toBe(" [accent]P[warning]i [dim]v1.2.0");
	});

	test("reads the live theme on every render", () => {
		let theme: any = fakeTheme;
		const component = new ByteflyHeader(
			() => theme,
			() => view(),
			"1.2.0",
		);

		expect(component.render(80)).toEqual([" Pi v1.2.0"]);
		theme = coloringTheme;
		expect(component.render(80)[0]).toContain("[accent]P");
	});
});

describe("bytefly header factory", () => {
	test("createHeader returns a factory that builds a component", () => {
		const factory = createHeader(
			() => fakeTheme,
			() => view(),
		);

		expect(typeof factory).toBe("function");
		expect(factory({ requestRender: () => {} } as any, fakeTheme).render(80)).toHaveLength(1);
	});
});
