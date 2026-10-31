/**
 * The Shift+Tab mode editor: the key in both encodings, the mode-aware border,
 * the toggle request, and the cleanup that gives the editor and the thinking-cycle
 * chord back.
 *
 * The keybinding registry is global, so the suite installs its own manager and
 * restores the previous one after each test, the way the chrome suite does.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings, KeybindingsManager, setKeybindings, type TUI, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import type { KeybindingDefinitions } from "@earendil-works/pi-tui";
import { PLAN_TOGGLE_REQUEST } from "../../../lib/plan-entry.ts";
import { PLAN_TOOL } from "../../../lib/tool-names.ts";
import { editorTheme } from "../../../lib/tui/chrome.ts";
import { isShiftTab } from "../../../lib/tui/cursor.ts";
import { coloringTheme, createFakePi } from "../../../test/helpers/fakes.ts";
import { stateEntry } from "../../../test/helpers/fixtures/plan.ts";
import { attachModeKey, ModeEditor } from "./editor.ts";

/** The editor only needs a repaint hook and a row count from the TUI. */
const tui = { requestRender: () => {}, terminal: { rows: 24 } } as unknown as TUI;

/** Definitions with the one app action this suite takes over. */
const DEFINITIONS = {
	...TUI_KEYBINDINGS,
	"app.thinking.cycle": { defaultKeys: "shift+tab", description: "Cycle thinking level" },
} as unknown as KeybindingDefinitions;

let previous: ReturnType<typeof getKeybindings>;
beforeEach(() => {
	previous = getKeybindings();
	setKeybindings(new KeybindingsManager(DEFINITIONS));
});
afterEach(() => {
	setKeybindings(previous);
});

/** A context double with the editor slot and a branch the border reads. */
function modeCtx(branch: unknown[] = []) {
	let factory: ((...args: any[]) => ModeEditor) | undefined;
	const notifications: string[] = [];
	const ctx = {
		mode: "tui",
		sessionManager: { getBranch: () => branch },
		ui: {
			theme: coloringTheme,
			setEditorComponent: (next?: unknown) => {
				factory = next as typeof factory;
			},
			getEditorComponent: () => factory,
			notify: (message: string) => notifications.push(message),
		},
	} as unknown as ExtensionContext;
	const editor = () => factory?.(tui, editorTheme(coloringTheme), getKeybindings());
	return { ctx, editor, notifications };
}

/** A pi double that reports `plan` as loaded. */
function piWithPlan() {
	return createFakePi({ allTools: [{ name: PLAN_TOOL }] }).pi;
}

describe("Shift+Tab", () => {
	test("accepts the Kitty and legacy encodings, and nothing else", () => {
		expect(isShiftTab("\u001b[Z")).toBe(true);
		expect(isShiftTab("\t")).toBe(false);
		expect(isShiftTab("\u001b")).toBe(false);
		expect(isShiftTab("a")).toBe(false);
	});
});

describe("ModeEditor", () => {
	function editor(isPlanning: () => boolean, onToggle: () => void): ModeEditor {
		return new ModeEditor(tui, editorTheme(coloringTheme), getKeybindings(), {
			onToggle,
			isPlanning,
			theme: () => coloringTheme,
		});
	}

	test("consumes Shift+Tab instead of inserting it and leaves other keys alone", () => {
		let toggles = 0;
		const subject = editor(
			() => false,
			() => toggles++,
		);

		subject.handleInput("\u001b[Z");
		expect(toggles).toBe(1);
		expect(subject.getText()).toBe("");

		subject.handleInput("a");
		expect(toggles).toBe(1);
		expect(subject.getText()).toBe("a");
	});

	test("paints the border accent in auto and warning while planning", () => {
		let planning = false;
		const subject = editor(
			() => planning,
			() => {},
		);

		expect(subject.render(20)[0]).toContain("[accent]");

		planning = true;
		expect(subject.render(20)[0]).toContain("[warning]");
	});

	test("carries the working line on its top border, as Pi's own editor does", () => {
		const subject = editor(
			() => false,
			() => {},
		);
		// The host only hands the indicator to an editor that opted in, so a `false` here
		// is a working line pushed back into a row above the composer.
		expect(subject.embedWorkingStatus).toBe(true);

		subject.setWorkingStatusIndicator({
			kind: "working",
			renderInBorder: () => "◐ working · 3 tools · 12s",
			renderSpinnerInBorder: () => "◐",
			dispose: () => {},
		} as unknown as Parameters<ModeEditor["setWorkingStatusIndicator"]>[0]);

		const top = subject.render(60)[0] ?? "";
		expect(top).toContain("◐ working · 3 tools · 12s");
		// The rules around it take the mode's role, the same one the border paints with.
		expect(top).toContain("[accent]");
	});
});

describe("attachModeKey", () => {
	test("does nothing without the plan extension", () => {
		const { pi } = createFakePi();
		const { ctx, editor } = modeCtx();

		expect(attachModeKey(pi, ctx)).toBeUndefined();
		expect(editor()).toBeUndefined();
		expect(getKeybindings().getKeys("app.thinking.cycle")).toEqual(["shift+tab"]);
	});

	test("installs the editor, takes the chord, and restores both on cleanup", () => {
		const bindings = getKeybindings();
		bindings.setUserBindings({ "app.thinking.cycle": "ctrl+shift+t" });
		const { ctx, editor } = modeCtx([stateEntry(true)]);

		const detach = attachModeKey(piWithPlan(), ctx);

		expect(editor()).toBeDefined();
		expect(getKeybindings().getKeys("app.thinking.cycle")).toEqual([]);

		detach?.();
		expect(editor()).toBeUndefined();
		expect(getKeybindings().getKeys("app.thinking.cycle")).toEqual(["ctrl+shift+t"]);
	});

	test("sends the toggle request when Shift+Tab is pressed", async () => {
		const pi = piWithPlan();
		let asked = 0;
		pi.events.on(PLAN_TOGGLE_REQUEST, (data: unknown) => {
			asked++;
			(data as { respond: (enabled: boolean) => void }).respond(true);
		});
		const { ctx, editor } = modeCtx();
		const detach = attachModeKey(pi, ctx);

		editor()?.handleInput("\u001b[Z");
		await Promise.resolve();

		expect(asked).toBe(1);
		detach?.();
	});

	test("leaves an editor a later extension installed in place", () => {
		const { ctx } = modeCtx();
		const detach = attachModeKey(piWithPlan(), ctx);
		const later = (() => ({ render: () => [], handleInput: () => {} })) as never;
		ctx.ui.setEditorComponent(later);

		detach?.();

		expect(ctx.ui.getEditorComponent()).toBe(later);
		// The binding is still ours to restore, because the editor check and the
		// binding check are independent.
		expect(getKeybindings().getKeys("app.thinking.cycle")).toEqual(["shift+tab"]);
	});
});
