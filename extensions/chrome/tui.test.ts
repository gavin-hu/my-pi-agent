import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { ChromeHeader, createHeader, type HeaderView } from "./tui.ts";

/** A header view with overrides, so each test states only what it exercises. */
const view = (overrides: Partial<HeaderView> = {}): HeaderView => ({
	mark: "wordmark",
	showVersion: true,
	...overrides,
});

function header(viewValue: HeaderView, version = "1.2.0"): ChromeHeader {
	return new ChromeHeader(
		() => fakeTheme,
		() => viewValue,
		version,
	);
}

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

	test("sheds the version before truncating the mark", () => {
		expect(header(view()).render(5)).toEqual(["", "Pi"]);
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
		);

		expect(typeof factory).toBe("function");
		expect(factory({ requestRender: () => {} } as any, fakeTheme).render(80)).toHaveLength(2);
	});
});
