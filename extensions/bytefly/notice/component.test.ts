import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { NoticeDetails } from "../../../lib/notice.ts";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { noticeLines } from "./component.ts";

const details: NoticeDetails = {
	source: "job",
	title: "2 background jobs finished",
	items: [
		{ label: "j1 build", detail: "exit 0", severity: "ok" },
		{ label: "j2 test", detail: "exit 1", severity: "bad" },
	],
};

describe("noticeLines", () => {
	test("draws the source, the title, and one row per item", () => {
		const lines = noticeLines(details, fakeTheme, 80);
		expect(lines[0]).toContain("job");
		expect(lines[0]).toContain("2 background jobs finished");
		expect(lines[1]).toContain("j1 build");
		expect(lines[1]).toContain("exit 0");
		expect(lines[2]).toContain("j2 test");
	});

	test("caps the rows and notes the rest", () => {
		const many: NoticeDetails = {
			source: "watch",
			title: "many",
			items: Array.from({ length: 12 }, (_, index) => ({ label: `row ${index + 1}` })),
		};
		const lines = noticeLines(many, fakeTheme, 80);
		expect(lines).toHaveLength(10);
		expect(lines.at(-1)).toContain("4 more");
	});

	test("sanitizes an untrusted label", () => {
		const evil: NoticeDetails = {
			source: "job",
			title: "x",
			items: [{ label: "a\u001b[31mb\u009dc" }],
		};
		expect(noticeLines(evil, fakeTheme, 80).join("\n")).not.toContain("\u001b");
	});

	test("clips every line to the width it was given", () => {
		const wide: NoticeDetails = {
			source: "job",
			title: "a headline that is far too long for the terminal",
			items: [{ label: "a row that is also far too long for the terminal" }],
		};
		for (const line of noticeLines(wide, fakeTheme, 20)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(20);
		}
	});

	test("paints the source in the accent role", () => {
		expect(noticeLines(details, coloringTheme, 80)[0]).toContain("[accent]job");
	});

	test("puts the headline at the margin and the rows behind the rail", () => {
		const lines = noticeLines(details, fakeTheme, 80);
		expect(lines[0]).toBe("job · 2 background jobs finished");
		expect(lines[1]?.startsWith("╎ ")).toBe(true);
		expect(lines[1]?.startsWith("╎  ")).toBe(false);
	});

	test("draws a configured rail glyph", () => {
		const lines = noticeLines(details, fakeTheme, 80, 0, "│");
		expect(lines[1]?.startsWith("│ ")).toBe(true);
	});

	test("paints the rail by the notice's worst severity", () => {
		expect(noticeLines(details, coloringTheme, 80)[1]).toContain("[error]╎");
		const clean: NoticeDetails = { source: "job", title: "all good", items: [{ label: "j1", severity: "ok" }] };
		expect(noticeLines(clean, coloringTheme, 80)[1]).toContain("[dim]╎");
	});

	test("insets the whole block by Pi's output pad", () => {
		const lines = noticeLines(details, fakeTheme, 80, 1);
		expect(lines[0]).toBe(" job · 2 background jobs finished");
		// The rail sits BODY_INDENT further in than the headline.
		expect(lines[1]?.startsWith(" ╎ ")).toBe(true);
	});

	test("clips a padded line to the width it was given", () => {
		for (const line of noticeLines(details, fakeTheme, 20, 4)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(20);
		}
	});

	test("leads every row with its own severity glyph", () => {
		const clean: NoticeDetails = { source: "job", title: "all good", items: [{ label: "j1", severity: "ok" }] };
		expect(noticeLines(clean, coloringTheme, 80).join("\n")).toContain("[success]");
		expect(noticeLines(details, coloringTheme, 80).join("\n")).toContain("[error]");
	});
});
