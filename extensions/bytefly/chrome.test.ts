import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	getKeybindings,
	KeybindingsManager,
	Markdown,
	setKeybindings,
	stripTerminalSequences,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { NoticeDetails, NoticeSeverity } from "../../lib/notice.ts";
import { NOTICE_TYPE } from "../../lib/notice.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";
import { coloringTheme, createFakePi, emit, fakeMarkdownTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import {
	createRailSource,
	DEFAULT_CHROME_CONFIG,
	DEFAULT_RAIL_GLYPH,
	loadChromeConfig,
	normalizeChromeConfig,
	RAIL_ROLES,
	registerChrome,
} from "./chrome.ts";
import { ByteflyHeader, createHeader, type HeaderView } from "./header/component.ts";
import { HEADER_CONFIG } from "./header/config.ts";
import { identityCells, type IdentityInput } from "./header/identity.ts";
import { registerHeader } from "./header/register.ts";
import { nameplate, styleUserMessage } from "./message/format.ts";
import { registerUserMessage } from "./message/register.ts";
import { NoticeComponent, noticeLines } from "./notice/component.ts";
import { registerNotice } from "./notice/register.ts";
import { createPadStore, DEFAULT_HOST_PAD } from "./pad.ts";
import { SeparatorComponent } from "./separator/component.ts";
import { receiptLabel, separatorLine } from "./separator/format.ts";
import { registerTurnSeparator } from "./separator/register.ts";
import { createUpdateState } from "./update/state.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A fresh project directory for a config or session test. */
function projectDir(): string {
	return temps.track(tempDir("bytefly-chrome-"));
}

/** A project document under `<cwd>/.pi`. */
function writeProject(cwd: string, document: unknown): void {
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "bytefly.json"), JSON.stringify(document));
}

describe("chrome config", () => {
	test("keeps a finished rail neutral and only warns or fails in colour", () => {
		expect(RAIL_ROLES.ok).toBe("faint");
		expect(RAIL_ROLES.info).toBe("info");
		expect(RAIL_ROLES.warn).toBe("warn");
		expect(RAIL_ROLES.bad).toBe("bad");
	});

	test("returns the base for missing input and accepts a one-column glyph", () => {
		expect(normalizeChromeConfig(undefined, DEFAULT_CHROME_CONFIG)).toEqual(DEFAULT_CHROME_CONFIG);
		expect(normalizeChromeConfig({ rail: "│" }, DEFAULT_CHROME_CONFIG).rail).toBe("│");
		expect(normalizeChromeConfig({ rail: "❘" }, DEFAULT_CHROME_CONFIG).rail).toBe("❘");
	});

	test("falls back on a wide, emoji, multi-glyph, empty, or control value", () => {
		for (const bad of ["中", "🚀", "ab", "", "  ", "\u001b"]) {
			expect(normalizeChromeConfig({ rail: bad }, DEFAULT_CHROME_CONFIG).rail).toBe(DEFAULT_RAIL_GLYPH);
		}
	});

	test("loads the defaults when no files exist", async () => {
		await withAgentDir(() => {
			expect(loadChromeConfig(projectDir())).toEqual(DEFAULT_CHROME_CONFIG);
		}, "bytefly-chrome-agent-");
	});

	test("merges global then project, with project winning", async () => {
		const repo = projectDir();
		writeProject(repo, { chrome: { rail: "│" } });
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), JSON.stringify({ chrome: { rail: "❘" } }));
			expect(loadChromeConfig(repo).rail).toBe("│");
		}, "bytefly-chrome-agent-");
	});

	test("ignores malformed files", async () => {
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), "{ not json");
			expect(loadChromeConfig(projectDir())).toEqual(DEFAULT_CHROME_CONFIG);
		}, "bytefly-chrome-agent-");
	});

	test("starts at the default and follows a valid glyph", () => {
		const rail = createRailSource();
		expect(rail.resolve()).toBe(DEFAULT_RAIL_GLYPH);
		rail.set("│");
		expect(rail.resolve()).toBe("│");
	});

	test("keeps the previous glyph when the next value is not one column", () => {
		const rail = createRailSource("│");
		rail.set("🚀");
		expect(rail.resolve()).toBe("│");
	});

	test("loads the glyph when a session starts and when the tree changes", async () => {
		const repo = projectDir();
		writeProject(repo, { chrome: { rail: "│" } });
		await withAgentDir(async () => {
			const fake = createFakePi();
			const rail = registerChrome(fake.pi);
			expect(rail.resolve()).toBe(DEFAULT_RAIL_GLYPH);
			await emit(fake.pi, "session_start", {}, { cwd: repo, mode: "tui" });
			expect(rail.resolve()).toBe("│");
			rail.set(DEFAULT_RAIL_GLYPH);
			await emit(fake.pi, "session_tree", {}, { cwd: repo, mode: "tui" });
			expect(rail.resolve()).toBe("│");
		}, "bytefly-chrome-agent-");
	});
});

describe("pad store", () => {
	test("falls back to Pi's default before anything is observed", () => {
		expect(DEFAULT_HOST_PAD).toBe(1);
		expect(createPadStore().resolve()).toBe(1);
		expect(createPadStore(0).resolve()).toBe(0);
	});

	test("records the host pad it is handed", () => {
		const pad = createPadStore();
		expect(pad.resolve(0)).toBe(0);
		expect(pad.resolve()).toBe(0);
		expect(pad.resolve(4)).toBe(4);
		expect(pad.resolve()).toBe(4);
	});

	test("keeps whole, non-negative columns and ignores a non-finite pad", () => {
		const pad = createPadStore();
		expect(pad.resolve(-3)).toBe(0);
		expect(pad.resolve(2.7)).toBe(2);
		expect(pad.resolve(Number.NaN)).toBe(2);
		expect(pad.resolve(Number.POSITIVE_INFINITY)).toBe(2);
	});
});

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
	// Pi mounts the built-in header inside `Spacer(1)`s, but the silenced branch keeps
	// no spacer for a custom header, so the component owns the leading blank row.
	test("opens with a blank row above the mark", () => {
		expect(header().render(80)[0]).toBe("");
	});

	test("renders the mark, identity, rule, and grouped help", () => {
		const lines = header().render(80);

		expect(lines).toHaveLength(7);
		expect(lines[1]).toContain("█▀█");
		expect(lines[1]).toContain("Pi v1.2.0");
		expect(lines[2]).toContain("█▀ █");
		expect(lines[2]).toContain(chrome);
		expect(lines[3]).toContain("─");
		expect(lines[4]).toContain("escape");
		expect(lines[4]).toContain("to interrupt");
		expect(lines[5]).toContain("to expand tools");
		expect(lines[6]).toContain("/ commands");
		expect(lines[6]).toContain("/bytefly extensions");
	});

	test("stops the rule at the transcript's right edge", () => {
		expect(visibleWidth(header().render(80)[3] ?? "")).toBe(79);
		expect(visibleWidth(header(view({ pad: 0 })).render(80)[3] ?? "")).toBe(80);
	});

	test("hangs the help one body indent inside the margin", () => {
		const flush = header(view({ pad: 0 })).render(80);

		expect(flush[1]?.startsWith("█▀█")).toBe(true);
		expect(visibleWidth(flush[3] ?? "")).toBe(80);
		expect(flush[4]?.startsWith("  escape")).toBe(true);
	});

	test("starts both identity cells at the same column", () => {
		const lines = header().render(80);
		expect(lines[1]?.indexOf("Pi v1.2.0")).toBe(lines[2]?.indexOf("enhanced by"));
	});

	test("drops the Pi version when showVersion is off", () => {
		const line = header(view({ showVersion: false })).render(80)[1] ?? "";
		expect(line).toContain("Pi");
		expect(line).not.toContain("v1.2.0");
	});

	test("falls back to the wordmark when half blocks do not render", () => {
		const lines = header(view({ halfBlocks: false })).render(80);

		// The wordmark is the app name, so it is not repeated beside the version.
		expect(lines[1]).toContain("Pi");
		expect(lines[1]).not.toContain("█");
		expect(lines[1]?.indexOf("v1.2.0")).toBe(6);
		expect(lines[1]?.split("Pi")).toHaveLength(2);
		expect(lines[2]).toContain(chrome);
		expect(lines[2]?.indexOf("enhanced by")).toBe(6);
	});

	test("omits a help row whose keybindings are all unbound", () => {
		setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
		const lines = header().render(80);

		expect(lines[4]).toBe("");
		expect(lines[5]).toBe("");
		const row = lines[6] ?? "";
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
		const line = header().render(80)[4] ?? "";

		expect(line).toContain("ctrl+x to exit");
		expect(line).not.toContain("ctrl+d");
	});

	test("adds the update marker after the chrome version", () => {
		expect(header(view({ latest: "0.12.0" })).render(80)[2]).toEndWith(`↑0.12.0`);
	});

	test("colors the marker with the accent, not a warning colour", () => {
		const lines = new ByteflyHeader(
			() => coloringTheme,
			() => view({ latest: "0.12.0" }),
			"1.2.0",
		).render(80);

		expect(lines[2]).toContain("[accent]↑0.12.0");
		expect(lines[2]).toContain(`[dim]v${HEADER_CONFIG.chromeVersion}`);
	});

	test("sheds the marker before the version, then the chrome line, then the agent", () => {
		const marked = view({ latest: "0.12.0" });

		expect(header(marked).render(41)[2]).toContain(chrome);
		expect(header(marked).render(41)[2]).toContain("↑0.12.0");
		expect(header(marked).render(40)[2]).toContain(chrome);
		expect(header(marked).render(40)[2]).not.toContain("↑0.12.0");
		expect(header(marked).render(32)[2]).toContain("enhanced by bytefly");
		expect(header(marked).render(32)[2]).not.toContain(`v${HEADER_CONFIG.chromeVersion}`);
		expect(header(marked).render(24)[1]).toContain("Pi v1.2.0");
		expect(header(marked).render(24)[2]).not.toContain("enhanced by");
		expect(header(marked).render(14)[1]).toContain("█▀█");
		expect(header(marked).render(14)[1]).not.toContain("Pi");
	});

	test("sheds the chrome version, then the chrome line, then the agent", () => {
		expect(header().render(25)[2]).toContain("enhanced by bytefly");
		expect(header().render(25)[2]).not.toContain(`v${HEADER_CONFIG.chromeVersion}`);
		expect(header().render(20)[1]).toContain("Pi v1.2.0");
		expect(header().render(20)[2]).not.toContain("enhanced by");
		expect(header().render(10)[1]).toContain("█▀█");
		expect(header().render(10)[1]).not.toContain("Pi");
		expect(header().render(10)[2]).toContain("█▀ █");
	});

	test("every line fits the requested width at any size", () => {
		for (const width of [1, 2, 4, 5, 14, 15, 24, 25, 31, 32, 45, 80]) {
			for (const halfBlocks of [true, false]) {
				for (const pad of [0, 1]) {
					const lines = header(view({ halfBlocks, pad })).render(width);
					expect(lines).toHaveLength(7);
					expect(lines[0]).toBe("");
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

		expect(lines[1]).toContain("[accent]█▀█");
		expect(lines[1]).toContain("[bold][text]Pi");
		expect(lines[1]).toContain("[dim]v1.2.0");
		expect(lines[2]).toContain("[warning]█▀ █");
		expect(lines[2]).toContain("[muted]bytefly");
		expect(lines[3]).toContain("[accent]");
		expect(lines[3]).toContain("[borderMuted]");
		expect(lines[4]).toContain("[dim]escape");
		expect(lines[4]).toContain("[muted] to interrupt");
	});

	test("anchors the rule's accent lead under the mark", () => {
		const lines = new ByteflyHeader(
			() => coloringTheme,
			() => view(),
			"1.2.0",
		).render(80);

		expect(lines[3]?.startsWith(" [accent]────[borderMuted]")).toBe(true);
	});

	test("reads the live theme on every render", () => {
		let theme: any = fakeTheme;
		const component = new ByteflyHeader(
			() => theme,
			() => view(),
			"1.2.0",
		);

		expect(component.render(80)[1]).toContain("Pi v1.2.0");
		theme = coloringTheme;
		expect(component.render(80)[1]).toContain("[accent]█▀█");
	});

	test("returns the same lines on a repeat render", () => {
		const component = new ByteflyHeader(
			() => fakeTheme,
			() => view(),
			"1.2.0",
		);

		expect(component.render(80)).toBe(component.render(80));
	});

	test("rebuilds when the width or the view changes", () => {
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
	});

	test("rebuilds when a keybinding changes", () => {
		const component = new ByteflyHeader(
			() => fakeTheme,
			() => view(),
			"1.2.0",
		);
		const beforeRebind = component.render(80);

		setKeybindings(
			new KeybindingsManager({
				...TUI_KEYBINDINGS,
				...APP_BINDINGS,
				"app.interrupt": { defaultKeys: "ctrl+q", description: "Cancel or abort" },
			}),
		);
		expect(component.render(80)).not.toBe(beforeRebind);
		expect(component.render(80).join("\n")).toContain("ctrl+q");
	});

	test("rebuilds when the update marker appears, and after invalidate", () => {
		let headerView = view();
		const component = new ByteflyHeader(
			() => fakeTheme,
			() => headerView,
			"1.2.0",
		);
		const before = component.render(80);

		headerView = view({ latest: "0.12.0" });
		expect(component.render(80)).not.toBe(before);
		expect(component.render(80)[2]).toContain("↑0.12.0");

		const marked = component.render(80);
		component.invalidate();
		expect(component.render(80)).not.toBe(marked);
	});
});

describe("ByteflyHeader by terminal height", () => {
	test("prints every help group at a tall terminal", () => {
		expect(header(view({ rows: 40 })).render(80)).toHaveLength(7);
	});

	test("drops the middle help group when the terminal is short", () => {
		const lines = header(view({ rows: 24 })).render(80);

		expect(lines).toHaveLength(6);
		expect(lines[4]).toContain("escape to interrupt");
		expect(lines[5]).toContain("/ commands");
		expect(lines.join("\n")).not.toContain("expand tools");
	});

	test("keeps only the commands row on a shorter terminal", () => {
		const lines = header(view({ rows: 18 })).render(80);

		expect(lines).toHaveLength(5);
		expect(lines[4]).toContain("/ commands");
	});

	test("drops the help block and its leading blank below the floor", () => {
		const lines = header(view({ rows: 10 })).render(80);

		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain("Pi v1.2.0");
		expect(lines[1]).toContain("enhanced by");
		expect(lines[2]).toContain("─");
	});

	test("treats a missing or impossible height as tall", () => {
		expect(header(view()).render(80)).toHaveLength(7);
		expect(header(view({ rows: 0 })).render(80)).toHaveLength(7);
	});

	test("rebuilds when the terminal height changes", () => {
		let headerView = view({ rows: 40 });
		const component = new ByteflyHeader(
			() => fakeTheme,
			() => headerView,
			"1.2.0",
		);
		const tall = component.render(80);

		headerView = view({ rows: 10 });

		expect(component.render(80)).not.toBe(tall);
		expect(component.render(80)).toHaveLength(3);
	});
});

describe("bytefly header factory", () => {
	test("createHeader returns a factory that builds a component", () => {
		const factory = createHeader(
			() => fakeTheme,
			(rows) => view({ rows }),
		);

		expect(typeof factory).toBe("function");
		expect(factory({ requestRender: () => {} } as any, fakeTheme).render(80)).toHaveLength(7);
	});

	test("reads the terminal height from the host", () => {
		const factory = createHeader(
			() => fakeTheme,
			(rows) => view({ rows }),
		);
		const host = { requestRender: () => {}, terminal: { rows: 18 } } as any;

		expect(factory(host, fakeTheme).render(80)).toHaveLength(5);
	});
});

/** Boot the header surface and record every `setHeader` call. */
function bootHeader(settings: Record<string, unknown>, mode = "tui") {
	const { pi } = createFakePi({ settings });
	const headers: Array<unknown> = [];
	const { ctx } = fakeCtx({ mode });
	ctx.ui.setHeader = (factory: unknown) => {
		headers.push(factory);
	};
	const updates = createUpdateState();
	const piUpdates = createUpdateState();
	const handle = registerHeader(pi, updates, piUpdates);
	return { pi, ctx, headers, updates, piUpdates, handle };
}

/** Render the last installed header at 80 columns, at an optional terminal height. */
function renderLast(headers: unknown[], rows?: number, width = 80): string[] {
	const factory = headers.at(-1) as ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined;
	if (typeof factory !== "function") return [];
	return factory(rows === undefined ? {} : { terminal: { rows } }, fakeTheme).render(width);
}

describe("header lifecycle", () => {
	test("installs the custom header when the bytefly startup TUI is on", async () => {
		const { pi, ctx, headers } = bootHeader({ quietStartup: true });

		await emit(pi, "session_start", {}, ctx);

		expect(typeof headers.at(-1)).toBe("function");
	});

	test("hands the installed header the terminal height", async () => {
		const { pi, ctx, headers } = bootHeader({ quietStartup: true });
		await emit(pi, "session_start", {}, ctx);

		expect(renderLast(headers, 40)).toHaveLength(7);
		expect(renderLast(headers, 18)).toHaveLength(5);
		expect(renderLast(headers, 10)).toHaveLength(3);
	});

	test("leaves Pi's built-in header for every other quietStartup value", async () => {
		for (const quietStartup of [false, "header", undefined]) {
			const { pi, ctx, headers } = bootHeader({ quietStartup });

			await emit(pi, "session_start", {}, ctx);

			expect(headers.at(-1), JSON.stringify(quietStartup)).toBeUndefined();
		}
	});

	test("does nothing outside the interactive mode", async () => {
		const { pi, ctx, headers } = bootHeader({ quietStartup: true }, "print");

		await emit(pi, "session_start", {}, ctx);

		expect(headers).toEqual([]);
	});

	test("restores the built-in header on shutdown", async () => {
		const { pi, ctx, headers } = bootHeader({ quietStartup: true });
		await emit(pi, "session_start", {}, ctx);

		await emit(pi, "session_shutdown", {}, ctx);

		expect(headers.at(-1)).toBeUndefined();
	});
});

describe("header identity ladder", () => {
	const input = (overrides: Partial<IdentityInput> = {}): IdentityInput => ({
		halfBlocks: true,
		showVersion: true,
		version: "1.2.0",
		...overrides,
	});

	test("puts the marker on the chrome row first, then sheds it", () => {
		const pairs = identityCells(input({ latest: "0.12.0" }), fakeTheme);

		expect(pairs[0]?.[1]).toContain("↑0.12.0");
		expect(pairs[1]?.[1]).not.toContain("↑");
	});

	test("names a rung only when it is narrower than the one before", () => {
		expect(identityCells(input(), fakeTheme)).toHaveLength(4);
		expect(identityCells(input({ latest: "0.12.0" }), fakeTheme)).toHaveLength(5);
	});

	test("ends by giving up both rows", () => {
		expect(identityCells(input({ latest: "0.12.0" }), fakeTheme).at(-1)).toEqual(["", ""]);
	});

	test("keeps only the version on the agent row where the mark spells the name", () => {
		const [pair] = identityCells(input({ halfBlocks: false }), fakeTheme);

		expect(pair?.[0]).toBe("v1.2.0");
	});
});

describe("header update marker", () => {
	test("renders no marker until a newer version is known", async () => {
		const { pi, ctx, headers } = bootHeader({ quietStartup: true });
		await emit(pi, "session_start", {}, ctx);

		expect(renderLast(headers)[2]).not.toContain("↑");
	});

	test("re-installs the header with the marker once the store holds a version", async () => {
		const { pi, ctx, headers, updates, handle } = bootHeader({ quietStartup: true });
		await emit(pi, "session_start", {}, ctx);

		updates.set("0.12.0");
		handle.refresh();

		expect(headers).toHaveLength(2);
		expect(renderLast(headers)[2]).toContain("↑0.12.0");
	});

	test("does nothing on refresh before a session started or after shutdown", async () => {
		const before = bootHeader({ quietStartup: true });
		before.handle.refresh();
		expect(before.headers).toEqual([]);

		const after = bootHeader({ quietStartup: true });
		await emit(after.pi, "session_start", {}, after.ctx);
		await emit(after.pi, "session_shutdown", {}, after.ctx);
		const installed = after.headers.length;

		after.updates.set("0.12.0");
		after.handle.refresh();
		expect(after.headers).toHaveLength(installed);
	});

	test("marks Pi's own row with the newer Pi version", async () => {
		const { pi, ctx, headers, piUpdates, handle } = bootHeader({ quietStartup: true });
		await emit(pi, "session_start", {}, ctx);

		piUpdates.set("1.4.0");
		handle.refresh();

		expect(renderLast(headers)[1]).toContain("↑1.4.0");
	});

	test("sheds the chrome marker before Pi's own", async () => {
		const { pi, ctx, headers, updates, piUpdates, handle } = bootHeader({ quietStartup: true });
		await emit(pi, "session_start", {}, ctx);
		updates.set("0.99.0");
		piUpdates.set("1.4.0");
		handle.refresh();

		const rows = renderLast(headers, undefined, 40);

		expect(rows[1]).toContain("↑1.4.0");
		expect(rows[2]).not.toContain("↑");
	});

	test("sheds Pi's own marker last, with the agent row", async () => {
		const { pi, ctx, headers, piUpdates, handle } = bootHeader({ quietStartup: true });
		await emit(pi, "session_start", {}, ctx);
		piUpdates.set("1.4.0");
		handle.refresh();

		const rows = renderLast(headers, undefined, 20);

		expect(rows[1]).toContain(HEADER_CONFIG.appName);
		expect(rows[1]).not.toContain("↑");
	});
});

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

	test("falls back for a severity the stored data does not know", () => {
		// `details` crosses a session-JSON boundary, so a hand-edited or older
		// message can carry a word the config has no role for; the rail must still
		// be painted instead of asking the theme for an unknown token.
		const unknown: NoticeDetails = {
			source: "job",
			title: "x",
			severity: "loud" as NoticeSeverity,
			items: [{ label: "row", severity: "shout" as NoticeSeverity }],
		};
		const text = noticeLines(unknown, coloringTheme, 80).join("\n");
		expect(text).toContain("╎");
		expect(text).toContain("◌");
		expect(text).not.toContain("[undefined]");
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
		expect(stripTerminalSequences(noticeLines(wide, fakeTheme, 20)[1] ?? "").endsWith("…")).toBe(true);
	});

	test("paints the source in the accent role", () => {
		expect(noticeLines(details, coloringTheme, 80)[0]).toContain("[accent]job");
	});

	test("puts the headline at the margin and the rows behind the rail", () => {
		const lines = noticeLines(details, fakeTheme, 80);
		expect(lines[0]?.startsWith("job")).toBe(true);
		expect(lines[0]).toContain("2 background jobs finished");
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

	test("paints the headline's title by the notice's own severity", () => {
		const budget: NoticeDetails = { source: "bytefly", title: "Session budget reached", severity: "warn" };
		expect(noticeLines(budget, coloringTheme, 80)[0]).toContain("[warning]Session budget reached");

		const failed: NoticeDetails = { source: "job", title: "the build failed", severity: "bad" };
		expect(noticeLines(failed, coloringTheme, 80)[0]).toContain("[error]the build failed");

		const routine: NoticeDetails = { source: "job", title: "2 background jobs finished", severity: "info" };
		expect(noticeLines(routine, coloringTheme, 80)[0]).toContain("[text]2 background jobs finished");
	});

	test("keeps a row's label at body text however severe the row is", () => {
		// `details` carries one `ok` row and one `bad` one; the rail goes red for the
		// failure, and only the glyphs state each row's verdict.
		const text = noticeLines(details, coloringTheme, 80).join("\n");
		expect(text).toContain("[text]2 background jobs finished");
		expect(text).toContain("[text]j2 test");
		expect(text).not.toContain("[error]j2 test");
	});

	test("insets the whole block by Pi's output pad", () => {
		const lines = noticeLines(details, fakeTheme, 80, 1);
		expect(lines[0]?.startsWith(" job")).toBe(true);
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

describe("NoticeComponent", () => {
	test("memoizes on width and drops the memo on invalidate", () => {
		const component = new NoticeComponent(details, fakeTheme, 1, "╎");
		const first = component.render(80);

		expect(component.render(80)).toBe(first);
		expect(component.render(40)).not.toBe(first);

		const narrow = component.render(40);
		component.invalidate();
		expect(component.render(40)).not.toBe(narrow);
	});
});

describe("registerNotice", () => {
	test("registers one renderer under the shared type", () => {
		const { pi, messageRenderers } = createFakePi();
		registerNotice(pi);
		expect(messageRenderers.has(NOTICE_TYPE)).toBe(true);
	});

	test("renders a notice and skips a message without details", () => {
		const { pi, messageRenderers } = createFakePi();
		registerNotice(pi);
		const renderer = messageRenderers.get(NOTICE_TYPE);

		const message = {
			customType: NOTICE_TYPE,
			content: "x",
			display: true,
			details: { source: "job", title: "done" },
		};
		expect(renderer(message, { expanded: false, outputPad: 0 }, fakeTheme).render(60).join("\n")).toContain("done");

		expect(
			renderer({ customType: NOTICE_TYPE, content: "x", display: true }, { expanded: false, outputPad: 0 }, fakeTheme),
		).toBeUndefined();
	});
});

describe("separatorLine", () => {
	test("renders one line of exactly the requested width", () => {
		for (const target of [0, 1, 5, 8, 9, 20, 40, 100]) {
			const lines = separatorLine({ turn: 3 }, target, fakeTheme);
			expect(lines).toHaveLength(1);
			expect(visibleWidth(lines[0] ?? "")).toBe(Math.max(1, target));
		}
	});

	test("centers the label and names the turn", () => {
		const line = separatorLine({ turn: 3 }, 41, fakeTheme)[0] ?? "";
		const label = " turn 3 ";
		const left = line.indexOf(label);
		const right = visibleWidth(line) - left - visibleWidth(label);
		expect(left).toBeGreaterThan(0);
		expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
	});

	test("degrades to a plain dashed rule when the label does not fit", () => {
		const line = separatorLine({ turn: 12 }, 5, fakeTheme)[0] ?? "";
		expect(line).not.toContain("turn");
		expect(line).toMatch(/^╌+$/);
	});

	test("paints the dashes and the label from their design roles", () => {
		const line = separatorLine({ turn: 2 }, 12, coloringTheme)[0] ?? "";
		expect(line).toContain("[border]");
		expect(line).toContain("[muted] turn 2 ");
	});

	test("insets the rule symmetrically by Pi's output pad", () => {
		const line = separatorLine({ turn: 3 }, 41, fakeTheme, 2)[0] ?? "";
		expect(line.startsWith("  ")).toBe(true);
		expect(line).toContain("turn 3");
		// Two columns on the left, the rule fills the middle, two remain on the right.
		expect(visibleWidth(line)).toBe(39);
	});

	test("a pad never collapses or overflows a narrow line", () => {
		for (const width of [1, 2, 3, 5, 20]) {
			const line = separatorLine({ turn: 3 }, width, fakeTheme, 8)[0] ?? "";
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(visibleWidth(line)).toBeGreaterThan(0);
		}
	});

	test("adds the duration and the top-level tool count", () => {
		const line = separatorLine({ turn: 4, durationMs: 72_000, tools: 7 }, 80, fakeTheme)[0] ?? "";
		expect(line).toContain("turn 4 · 1m12s · 7 tools");
	});

	test("counts failed tools and singularizes one", () => {
		const line = separatorLine({ turn: 4, tools: 1, failures: 1 }, 80, fakeTheme)[0] ?? "";
		expect(line).toContain("turn 4 · 1 tool · ✕1");
	});

	test("names an aborted run instead of its tool count", () => {
		const line = separatorLine({ turn: 4, tools: 3, failures: 2, aborted: true }, 80, fakeTheme)[0] ?? "";
		expect(line).toContain("turn 4 · 3 tools · aborted");
		expect(line).not.toContain("✕");
	});

	test("keeps a sub-second turn quiet", () => {
		const line = separatorLine({ turn: 4, durationMs: 400, tools: 2 }, 80, fakeTheme)[0] ?? "";
		expect(line).toContain("turn 4 · 2 tools");
		expect(line).not.toContain("400ms");
	});

	test("sheds tools, then duration, then the outcome as the line narrows", () => {
		const data = { turn: 4, durationMs: 72_000, tools: 7, failures: 1 };

		expect(separatorLine(data, 30, fakeTheme)[0]).toContain("turn 4 · 1m12s · ✕1");
		expect(separatorLine(data, 20, fakeTheme)[0]).toContain("turn 4 · ✕1");
		expect(separatorLine(data, 12, fakeTheme)[0]).toContain("turn 4");
	});

	test("colors a failed turn as an error and an aborted turn as a warning", () => {
		expect(separatorLine({ turn: 4, failures: 1 }, 80, coloringTheme)[0]).toContain("[error] turn 4 · ✕1 ");
		expect(separatorLine({ turn: 4, aborted: true }, 80, coloringTheme)[0]).toContain("[warning] turn 4 · aborted ");
	});

	test("fits the requested width with a receipt", () => {
		const data = { turn: 4, durationMs: 72_000, tools: 7, failures: 1, aborted: false };
		for (const target of [1, 5, 8, 12, 20, 30, 40, 100]) {
			const lines = separatorLine(data, target, fakeTheme);
			expect(lines).toHaveLength(1);
			expect(visibleWidth(lines[0] ?? "")).toBe(Math.max(1, target));
		}
	});

	test("receiptLabel keeps the outcome beside the turn longest", () => {
		expect(receiptLabel({ turn: 4, durationMs: 72_000, tools: 7, failures: 1 }, 20)).toContain("✕1");
		expect(receiptLabel({ turn: 4, durationMs: 72_000, tools: 7, failures: 1 }, 8)).toBe("turn 4");
	});
});

describe("SeparatorComponent", () => {
	test("renders the line for its width and pad and memoizes the frame", () => {
		const component = new SeparatorComponent({ turn: 3 }, fakeTheme, 1);
		const line = separatorLine({ turn: 3 }, 41, fakeTheme, 1);

		expect(component.render(41)).toEqual(line);
		expect(component.render(41)).toBe(component.render(41));
		expect(component.render(40)).not.toBe(component.render(41));
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

describe("registerTurnSeparator", () => {
	test("registers the bytefly-separator renderer and not the retired one", () => {
		const { pi, renderers } = createFakePi();
		registerTurnSeparator(pi);
		expect(renderers.has("bytefly-separator")).toBe(true);
		expect(renderers.has("turn-separator")).toBe(false);
	});

	test("appends the next turn when the agent settles", async () => {
		const { pi, appended } = createFakePi();
		registerTurnSeparator(pi);

		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ branch: [] }).ctx);
		await emit(
			pi,
			"agent_settled",
			{ type: "agent_settled" },
			fakeCtx({ branch: [{ type: "custom", customType: "bytefly-separator", data: { turn: 1 } }] }).ctx,
		);

		expect(appended).toEqual([
			{ customType: "bytefly-separator", data: { turn: 1 } },
			{ customType: "bytefly-separator", data: { turn: 2 } },
		]);
	});

	test("does not count the retired turn-separator entries", async () => {
		const { pi, appended } = createFakePi();
		registerTurnSeparator(pi);

		const legacy = { type: "custom", customType: "turn-separator", data: { turn: 9 } };
		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ branch: [legacy] }).ctx);

		expect(appended).toEqual([{ customType: "bytefly-separator", data: { turn: 1 } }]);
	});

	test("does nothing outside interactive mode", async () => {
		const { pi, appended } = createFakePi();
		registerTurnSeparator(pi);

		await emit(pi, "agent_settled", { type: "agent_settled" }, fakeCtx({ mode: "print" }).ctx);

		expect(appended).toHaveLength(0);
	});

	test("records the settled run's receipt", async () => {
		let time = 0;
		const { pi, appended } = createFakePi();
		registerTurnSeparator(pi, createPadStore(), { now: () => time });
		const { ctx } = fakeCtx({ branch: [] });

		await emit(pi, "agent_start", { type: "agent_start" }, ctx);
		time = 5000;
		await emit(pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, ctx);
		await emit(pi, "tool_execution_start", { toolCallId: "2", toolName: "edit" }, ctx);
		await emit(pi, "tool_execution_end", { toolCallId: "2", toolName: "edit", isError: true }, ctx);
		await emit(pi, "agent_settled", { type: "agent_settled", aborted: false }, ctx);

		expect(appended).toEqual([
			{ customType: "bytefly-separator", data: { turn: 1, durationMs: 5000, tools: 2, failures: 1 } },
		]);
	});

	test("keeps one duration across a retry's second agent_start", async () => {
		let time = 0;
		const { pi, appended } = createFakePi();
		registerTurnSeparator(pi, createPadStore(), { now: () => time });
		const { ctx } = fakeCtx({ branch: [] });

		await emit(pi, "agent_start", { type: "agent_start" }, ctx);
		time = 1000;
		await emit(pi, "agent_start", { type: "agent_start" }, ctx);
		time = 3000;
		await emit(pi, "agent_settled", { type: "agent_settled" }, ctx);

		expect((appended[0]?.data as { durationMs?: number }).durationMs).toBe(3000);
	});

	test("ignores nested tools in the receipt", async () => {
		let time = 0;
		const { pi, appended } = createFakePi();
		registerTurnSeparator(pi, createPadStore(), { now: () => time });
		const { ctx } = fakeCtx({ branch: [] });

		await emit(pi, "agent_start", { type: "agent_start" }, ctx);
		time = 1000;
		await emit(pi, "tool_execution_start", { toolCallId: "1", toolName: "read" }, ctx);
		await emit(pi, "tool_execution_start", { toolCallId: "2", toolName: "inner", parentToolCallId: "1" }, ctx);
		await emit(
			pi,
			"tool_execution_end",
			{ toolCallId: "2", toolName: "inner", parentToolCallId: "1", isError: true },
			ctx,
		);
		await emit(pi, "agent_settled", { type: "agent_settled" }, ctx);

		expect(appended).toEqual([{ customType: "bytefly-separator", data: { turn: 1, durationMs: 1000, tools: 1 } }]);
	});

	test("records an aborted run", async () => {
		let time = 0;
		const { pi, appended } = createFakePi();
		registerTurnSeparator(pi, createPadStore(), { now: () => time });
		const { ctx } = fakeCtx({ branch: [] });

		await emit(pi, "agent_start", { type: "agent_start" }, ctx);
		time = 1500;
		await emit(pi, "agent_settled", { type: "agent_settled", aborted: true }, ctx);

		expect(appended).toEqual([{ customType: "bytefly-separator", data: { turn: 1, durationMs: 1500, aborted: true } }]);
	});

	test("renders the stored turn number and receipt", () => {
		const { pi, renderers } = createFakePi();
		registerTurnSeparator(pi);
		const renderer = renderers.get("bytefly-separator");
		const component = renderer(
			{ type: "custom", customType: "bytefly-separator", data: { turn: 4, durationMs: 72_000, tools: 7, failures: 1 } },
			{ expanded: false },
			fakeTheme,
		);

		const text = component.render(80).join("\n");
		expect(text).toContain("turn 4 · 1m12s · 7 tools · ✕1");
	});

	test("ignores an entry without a turn number", () => {
		const { pi, renderers } = createFakePi();
		registerTurnSeparator(pi);
		const renderer = renderers.get("bytefly-separator");

		expect(
			renderer({ type: "custom", customType: "bytefly-separator" }, { expanded: false }, fakeTheme),
		).toBeUndefined();
	});
});

describe("user-message nameplate", () => {
	const at = (
		messageType: "user" | "assistant" | "assistant-thinking",
		availableWidth = 80,
	): {
		messageType: "user" | "assistant" | "assistant-thinking";
		isStreaming: boolean;
		availableWidth: number;
	} => ({ messageType, isStreaming: false, availableWidth });
	const user = (availableWidth = 80) => at("user", availableWidth);

	test("draws the label over a full-width rule", () => {
		const text = nameplate(20) ?? "";
		expect(text.startsWith("## You")).toBe(true);
		expect(text.endsWith("─".repeat(20))).toBe(true);
	});

	test("still draws the full-width rule when the label just fits", () => {
		expect(nameplate(3)?.endsWith("─".repeat(3))).toBe(true);
	});

	test("drops the nameplate when the label does not fit", () => {
		expect(nameplate(2)).toBeUndefined();
	});

	test("puts the nameplate above the message", () => {
		const text = styleUserMessage("hello", user(20));
		expect(text.startsWith("## You")).toBe(true);
		expect(text).toContain("hello");
		expect(text.indexOf("hello")).toBeGreaterThan(text.indexOf("## You"));
	});

	test("leaves non-user messages and empty text unchanged", () => {
		const blank = "   \n  ";
		expect(styleUserMessage("hello", at("assistant"))).toBe("hello");
		expect(styleUserMessage("hello", at("assistant-thinking"))).toBe("hello");
		expect(styleUserMessage(blank, user())).toBe(blank);
		expect(styleUserMessage("", user())).toBe("");
	});

	test("renders the label over the rule above the body without a hash prefix", () => {
		const component = new Markdown("hello", 0, 0, fakeMarkdownTheme(), undefined, {
			transform: (text, availableWidth) => styleUserMessage(text, user(availableWidth)),
		});
		const lines = component.render(40).map((line) => line.replace(/\s+$/, ""));

		expect(lines[0]).toBe("You");
		expect(lines[1]).toBe("─".repeat(40));
		const joined = lines.join("\n");
		expect(joined).not.toContain("#");
		expect(joined).not.toContain("❯");
		expect(joined).toContain("hello");
	});

	test("keeps a code-first message as code", () => {
		const component = new Markdown("```js\nconst x = 1;\n```", 0, 0, fakeMarkdownTheme(), undefined, {
			transform: (text, availableWidth) => styleUserMessage(text, user(availableWidth)),
		});
		expect(component.render(40).join("\n")).toContain("const x = 1;");
	});
});

describe("registerUserMessage", () => {
	test("registers exactly one transformer", () => {
		const { pi, markdownTransformers } = createFakePi();
		registerUserMessage(pi);
		expect(markdownTransformers).toHaveLength(1);
	});

	test("marks a user message and leaves an assistant one alone", () => {
		const { pi, markdownTransformers } = createFakePi();
		registerUserMessage(pi);
		const transform = markdownTransformers[0];

		const context = { messageType: "user" as const, isStreaming: false, availableWidth: 40 };
		expect(transform("hello", context)).toContain("You");
		expect(transform("hello", context)).not.toContain("❯");
		expect(transform("hello", { ...context, messageType: "assistant" })).toBe("hello");
	});
});
