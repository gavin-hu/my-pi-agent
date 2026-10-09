import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import {
	getKeybindings,
	KeybindingsManager,
	resetCapabilitiesCache,
	setCapabilities,
	setKeybindings,
	TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { EXPAND_KEYBINDING } from "../../lib/ui.ts";
import { expandHint, formatDocCall, previewText, renderDocPath } from "./render.ts";

beforeEach(() => {
	// Deterministic, hyperlink-free capabilities; individual tests opt in.
	setCapabilities({ images: null, trueColor: false, hyperlinks: false });
});

afterEach(() => {
	resetCapabilitiesCache();
});

describe("renderDocPath", () => {
	test("shortens a home-directory path to ~", () => {
		const home = homedir();
		expect(renderDocPath(`${home}/docs/a.pdf`, fakeTheme, "/work")).toBe("~/docs/a.pdf");
	});

	test("leaves a path outside home unchanged", () => {
		expect(renderDocPath("/tmp/a.pdf", fakeTheme, "/work")).toBe("/tmp/a.pdf");
	});

	test("collapses a path with control characters onto one line", () => {
		expect(renderDocPath("a\u0001b.pdf", fakeTheme, "/work")).toBe("a b.pdf");
	});

	test("reports a missing path argument", () => {
		expect(renderDocPath(undefined, fakeTheme, "/work")).toBe("[invalid arg]");
	});

	test("links the path when the terminal supports OSC 8", () => {
		setCapabilities({ images: null, trueColor: false, hyperlinks: true });
		const rendered = renderDocPath("docs/a.pdf", fakeTheme, "/work");
		expect(rendered).toContain("\u001b]8;;file://");
		expect(rendered).toContain("docs/a.pdf");
	});
});

describe("expandHint", () => {
	test("renders the bound expand key", () => {
		const previous = getKeybindings();
		setKeybindings(
			new KeybindingsManager({
				...TUI_KEYBINDINGS,
				[EXPAND_KEYBINDING]: { defaultKeys: "ctrl+o", description: "Toggle tool output" },
			}),
		);
		try {
			expect(expandHint(fakeTheme)).toContain("ctrl+o");
		} finally {
			setKeybindings(previous);
		}
	});
});

describe("previewText", () => {
	test("caps the preview and reports the overflow", () => {
		const { body, moreLines } = previewText("a\nb\nc\nd", 2);
		expect(body).toBe("a\nb");
		expect(moreLines).toBe(2);
	});

	test("strips control characters, expands tabs, and drops trailing blanks", () => {
		const { body, moreLines } = previewText("a\tb\u0001\n\n", 5);
		expect(body).toBe(`a${" ".repeat(3)}b `);
		expect(moreLines).toBe(0);
	});
});

describe("formatDocCall", () => {
	test("humanizes the paging options", () => {
		const rendered = formatDocCall({ path: "spec.pdf", startIndex: 40000, maxChars: 80000 }, fakeTheme, {
			cwd: "/work",
		});
		expect(rendered).toContain("read_doc");
		expect(rendered).toContain("spec.pdf");
		expect(rendered).toContain("(from 40k, max 80k)");
	});

	test("omits options that were not set", () => {
		const rendered = formatDocCall({ path: "spec.pdf" }, fakeTheme, { cwd: "/work" });
		expect(rendered).not.toContain("from");
		expect(rendered).not.toContain("max");
	});

	test("omits a zero startIndex", () => {
		const rendered = formatDocCall({ path: "spec.pdf", startIndex: 0 }, fakeTheme, { cwd: "/work" });
		expect(rendered).not.toContain("from");
	});
});
