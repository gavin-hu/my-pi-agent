import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	getKeybindings,
	KeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { ByteflyHeader, createHeader, type HeaderView } from "./component.ts";
import { HEADER_CONFIG } from "./config.ts";

/** The app keybindings the header resolves, with Pi's default chords. */
const APP_BINDINGS = {
	"app.interrupt": { defaultKeys: "escape", description: "Cancel or abort" },
	"app.clear": { defaultKeys: "ctrl+c", description: "Clear editor" },
	"app.exit": { defaultKeys: "ctrl+d", description: "Exit when editor is empty" },
	"app.suspend": { defaultKeys: "ctrl+z", description: "Suspend to background" },
	"app.tools.expand": { defaultKeys: "ctrl+o", description: "Toggle tool output" },
	"app.thinking.toggle": { defaultKeys: "ctrl+t", description: "Toggle thinking blocks" },
	"app.thinking.cycle": { defaultKeys: "shift+tab", description: "Cycle thinking level" },
	"app.model.cycleForward": { defaultKeys: "ctrl+p", description: "Cycle to next model" },
	"app.model.select": { defaultKeys: "ctrl+l", description: "Open model selector" },
	"app.editor.external": { defaultKeys: "ctrl+g", description: "Open external editor" },
	"app.message.followUp": { defaultKeys: "alt+enter", description: "Queue follow-up message" },
	"app.clipboard.pasteImage": { defaultKeys: "ctrl+v", description: "Paste from clipboard" },
} as const;

/** The full chrome identity on the second row, with the package's own version. */
const chrome = `enhanced by bytefly v${HEADER_CONFIG.chromeVersion}`;

let previous: ReturnType<typeof getKeybindings>;
beforeEach(() => {
	previous = getKeybindings();
	setKeybindings(new KeybindingsManager({ ...TUI_KEYBINDINGS, ...APP_BINDINGS }));
});
afterEach(() => {
	setKeybindings(previous);
});

/** A view with overrides, so each test states only what it exercises. */
const view = (overrides: Partial<HeaderView> = {}): HeaderView => ({
	showVersion: true,
	halfBlocks: true,
	pad: 1,
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
	test("renders the mark, identity, rule, and grouped help", () => {
		expect(header().render(80)).toEqual([
			" █▀█  Pi v1.2.0",
			` █▀ █ ${chrome}`,
			` ${"─".repeat(78)}`,
			"   escape to interrupt · ctrl+c to clear · ctrl+d to exit (empty)",
			"   ctrl+o to expand tools · ctrl+t to expand thinking · ctrl+l to select model",
			"   / commands · ! bash · !! bash (no context) · /bytefly extensions",
		]);
	});

	test("stops the rule at the transcript's right edge", () => {
		expect(visibleWidth(header().render(80)[2] ?? "")).toBe(79);
		expect(visibleWidth(header(view({ pad: 0 })).render(80)[2] ?? "")).toBe(80);
	});

	test("hangs the help one body indent inside the margin", () => {
		const flush = header(view({ pad: 0 })).render(80);

		expect(flush[0]).toBe("█▀█  Pi v1.2.0");
		expect(flush[2]).toBe("─".repeat(80));
		expect(flush[3]?.startsWith("  escape")).toBe(true);
	});

	test("starts both identity cells at the same column", () => {
		const lines = header().render(80);
		expect(lines[0]?.indexOf("Pi v1.2.0")).toBe(lines[1]?.indexOf("enhanced by"));
	});

	test("drops the Pi version when showVersion is off", () => {
		expect(header(view({ showVersion: false })).render(80)[0]).toBe(" █▀█  Pi");
	});

	test("falls back to the wordmark when half blocks do not render", () => {
		const lines = header(view({ halfBlocks: false })).render(80);

		// The wordmark is the app name, so it is not repeated beside the version.
		expect(lines[0]).toContain("Pi");
		expect(lines[0]).not.toContain("█");
		expect(lines[0]?.indexOf("v1.2.0")).toBe(6);
		expect(lines[0]?.split("Pi")).toHaveLength(2);
		expect(lines[1]).toContain(chrome);
		expect(lines[1]?.indexOf("enhanced by")).toBe(6);
	});

	test("omits a help row whose keybindings are all unbound", () => {
		setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
		const lines = header().render(80);

		expect(lines[3]).toBe("");
		expect(lines[4]).toBe("");
		const row = lines[5] ?? "";
		expect(row.indexOf("/")).toBe(3);
		expect(row).toContain("/ commands · ! bash · !! bash (no context) · /bytefly extensions");
	});

	test("resolves a chord live, so a rebound key shows up", () => {
		setKeybindings(
			new KeybindingsManager({
				...TUI_KEYBINDINGS,
				...APP_BINDINGS,
				"app.exit": { defaultKeys: "ctrl+x", description: "Exit when editor is empty" },
			}),
		);
		const line = header().render(80)[3] ?? "";

		expect(line).toContain("ctrl+x to exit");
		expect(line).not.toContain("ctrl+d");
	});

	test("adds the update marker after the chrome version", () => {
		expect(header(view({ latest: "0.12.0" })).render(80)[1]).toBe(` █▀ █ ${chrome} ↑0.12.0`);
	});

	test("colors the marker with the accent, not a warning colour", () => {
		const lines = new ByteflyHeader(
			() => coloringTheme,
			() => view({ latest: "0.12.0" }),
			"1.2.0",
		).render(80);

		expect(lines[1]).toContain("[accent]↑0.12.0");
		expect(lines[1]).toContain(`[dim]v${HEADER_CONFIG.chromeVersion}`);
	});

	test("sheds the marker before the version, then the chrome line, then the agent", () => {
		const marked = view({ latest: "0.12.0" });

		expect(header(marked).render(41)[1]).toBe(` █▀ █ ${chrome} ↑0.12.0`);
		expect(header(marked).render(40)[1]).toBe(` █▀ █ ${chrome}`);
		expect(header(marked).render(32)[1]).toBe(" █▀ █ enhanced by bytefly");
		expect(header(marked).render(24)[0]).toBe(" █▀█  Pi v1.2.0");
		expect(header(marked).render(24)[1]).toBe(" █▀ █");
		expect(header(marked).render(14)[0]).toBe(" █▀█");
	});

	test("sheds the chrome version, then the chrome line, then the agent", () => {
		expect(header().render(25)[1]).toBe(" █▀ █ enhanced by bytefly");
		expect(header().render(20)[0]).toBe(" █▀█  Pi v1.2.0");
		expect(header().render(20)[1]).toBe(" █▀ █");
		expect(header().render(10)[0]).toBe(" █▀█");
		expect(header().render(10)[1]).toBe(" █▀ █");
	});

	test("every line fits the requested width at any size", () => {
		for (const width of [1, 2, 4, 5, 14, 15, 24, 25, 31, 32, 45, 80]) {
			for (const halfBlocks of [true, false]) {
				for (const pad of [0, 1]) {
					const lines = header(view({ halfBlocks, pad })).render(width);
					expect(lines).toHaveLength(6);
					for (const line of lines) {
						expect(visibleWidth(line)).toBeLessThanOrEqual(width);
					}
				}
			}
		}
	});

	test("colors the mark, identity, rule, and help from the active theme", () => {
		const lines = new ByteflyHeader(
			() => coloringTheme,
			() => view(),
			"1.2.0",
		).render(80);

		expect(lines[0]).toContain("[accent]█▀█");
		expect(lines[0]).toContain("[bold][text]Pi");
		expect(lines[0]).toContain("[dim]v1.2.0");
		expect(lines[1]).toContain("[warning]█▀ █");
		expect(lines[1]).toContain("[muted]bytefly");
		expect(lines[2]).toContain("[accent]");
		expect(lines[2]).toContain("[borderMuted]");
		expect(lines[3]).toContain("[dim]escape");
		expect(lines[3]).toContain("[muted] to interrupt");
	});

	test("anchors the rule's accent lead under the mark", () => {
		const lines = new ByteflyHeader(
			() => coloringTheme,
			() => view(),
			"1.2.0",
		).render(80);

		expect(lines[2]?.startsWith(" [accent]────[borderMuted]")).toBe(true);
	});

	test("reads the live theme on every render", () => {
		let theme: any = fakeTheme;
		const component = new ByteflyHeader(
			() => theme,
			() => view(),
			"1.2.0",
		);

		expect(component.render(80)[0]).toBe(" █▀█  Pi v1.2.0");
		theme = coloringTheme;
		expect(component.render(80)[0]).toContain("[accent]█▀█");
	});

	test("returns the same lines on a repeat render", () => {
		const component = new ByteflyHeader(
			() => fakeTheme,
			() => view(),
			"1.2.0",
		);

		expect(component.render(80)).toBe(component.render(80));
	});

	test("rebuilds when the width, the view, or a keybinding changes", () => {
		let headerView = view();
		const component = new ByteflyHeader(
			() => fakeTheme,
			() => headerView,
			"1.2.0",
		);
		const first = component.render(80);

		expect(component.render(81)).not.toBe(first);
		headerView = { ...view(), halfBlocks: false };
		expect(component.render(81)).not.toBe(first);

		const beforeRebind = component.render(81);
		setKeybindings(
			new KeybindingsManager({
				...TUI_KEYBINDINGS,
				...APP_BINDINGS,
				"app.interrupt": { defaultKeys: "ctrl+q", description: "Cancel or abort" },
			}),
		);
		expect(component.render(81)).not.toBe(beforeRebind);
		expect(component.render(81).join("\n")).toContain("ctrl+q");
	});

	test("rebuilds when the update marker appears", () => {
		let headerView = view();
		const component = new ByteflyHeader(
			() => fakeTheme,
			() => headerView,
			"1.2.0",
		);
		const before = component.render(80);

		headerView = view({ latest: "0.12.0" });

		expect(component.render(80)).not.toBe(before);
		expect(component.render(80)[1]).toContain("↑0.12.0");
	});

	test("rebuilds after invalidate even when nothing else changed", () => {
		const component = new ByteflyHeader(
			() => fakeTheme,
			() => view(),
			"1.2.0",
		);
		const first = component.render(80);

		component.invalidate();

		expect(component.render(80)).not.toBe(first);
	});
});

describe("bytefly header factory", () => {
	test("createHeader returns a factory that builds a component", () => {
		const factory = createHeader(
			() => fakeTheme,
			() => view(),
		);

		expect(typeof factory).toBe("function");
		expect(factory({ requestRender: () => {} } as any, fakeTheme).render(80)).toHaveLength(6);
	});
});
