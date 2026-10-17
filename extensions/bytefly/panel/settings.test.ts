import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import type { Settings, WriteScope } from "../picker/types.ts";
import {
	SETTING_GROUPS,
	SETTING_ROWS,
	countSettings,
	groupViews,
	nextValue,
	rowsForScope,
	type SettingDescriptor,
	settingViews,
	type SettingsSnapshot,
	storedValue,
	validValue,
} from "./settings.ts";

function snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
	return { app: overrides.app ?? {}, global: overrides.global ?? {}, project: overrides.project ?? {} };
}

function row(id: string): SettingDescriptor {
	const found = SETTING_ROWS.find((entry) => entry.id === id);
	if (!found) throw new Error(`missing row ${id}`);
	return found;
}

function view(id: string, scope: WriteScope, snap: SettingsSnapshot) {
	const found = settingViews(snap, scope).find((entry) => entry.id === id);
	if (!found) throw new Error(`missing view ${id}`);
	return found;
}

describe("catalogue", () => {
	test("lists the five v1 rows in screen order", () => {
		expect(SETTING_ROWS.map((entry) => entry.id)).toEqual([
			"byteflyUi",
			"notify.enabled",
			"chrome.rail",
			"outputPad",
			"showHardwareCursor",
		]);
	});

	test("shows app rows only in Global scope", () => {
		expect(rowsForScope("global").map((entry) => entry.id)).toEqual([
			"byteflyUi",
			"notify.enabled",
			"chrome.rail",
			"outputPad",
			"showHardwareCursor",
		]);
		expect(rowsForScope("project").map((entry) => entry.id)).toEqual(["notify.enabled", "chrome.rail"]);
		expect(countSettings("global")).toBe(5);
		expect(countSettings("project")).toBe(2);
	});

	test("orders the groups and drops an empty one", () => {
		expect(SETTING_GROUPS.map((group) => group.key)).toEqual(["startup", "notifications", "transcript", "terminal"]);
		const grouped = groupViews(settingViews(snapshot(), "project"));
		expect(grouped.map((group) => group.key)).toEqual(["notifications", "transcript"]);
		expect(grouped.map((group) => group.views.length)).toEqual([1, 1]);
	});
});

describe("values", () => {
	test("reads the defaults when neither file sets a key", () => {
		const global = settingViews(snapshot(), "global");
		expect(global.map((entry) => [entry.id, entry.value, entry.valueLabel, entry.origin])).toEqual([
			["byteflyUi", "false", "Off", "default"],
			["notify.enabled", "false", "Off", "default"],
			["chrome.rail", GLYPHS.divider, GLYPHS.divider, "default"],
			["outputPad", "1", "1", "default"],
			["showHardwareCursor", "false", "Off", "default"],
		]);

		const project = settingViews(snapshot(), "project");
		expect(project.map((entry) => entry.origin)).toEqual(["inherited", "inherited"]);
	});

	test("reads configured app and bytefly values", () => {
		const snap = snapshot({
			app: { quietStartup: true, outputPad: 0, showHardwareCursor: true } as Settings,
			global: { notify: { enabled: true }, chrome: { rail: "│" } },
		});

		expect(view("byteflyUi", "global", snap).valueLabel).toBe("On");
		expect(view("byteflyUi", "global", snap).origin).toBe("global");
		expect(view("notify.enabled", "global", snap).valueLabel).toBe("On");
		expect(view("notify.enabled", "global", snap).origin).toBe("global");
		expect(view("chrome.rail", "global", snap).value).toBe("│");
		expect(view("outputPad", "global", snap).value).toBe("0");
		expect(view("showHardwareCursor", "global", snap).valueLabel).toBe("On");
	});

	test("reads a hand-set header-only startup as bytefly UI off", () => {
		const snap = snapshot({ app: { quietStartup: "header" } as Settings });

		expect(view("byteflyUi", "global", snap).valueLabel).toBe("Off");
		expect(view("byteflyUi", "global", snap).origin).toBe("global");
	});

	test("inherits the global value in Project scope until a project key overrides it", () => {
		const snap = snapshot({
			global: { notify: { enabled: true }, chrome: { rail: "│" } },
			project: { notify: { enabled: false } },
		});

		expect(view("notify.enabled", "project", snap).valueLabel).toBe("Off");
		expect(view("notify.enabled", "project", snap).origin).toBe("project");
		expect(view("chrome.rail", "project", snap).value).toBe("│");
		expect(view("chrome.rail", "project", snap).origin).toBe("inherited");
	});

	test("shows the loader fallback for an invalid stored value", () => {
		const snap = snapshot({ global: { notify: { enabled: "yes" }, chrome: { rail: "ab" } } });

		expect(view("notify.enabled", "global", snap).valueLabel).toBe("Off");
		expect(view("notify.enabled", "global", snap).origin).toBe("global");
		expect(view("chrome.rail", "global", snap).value).toBe(GLYPHS.divider);
	});
});

describe("cycling", () => {
	test("wraps each row through its curated options", () => {
		const ui = row("byteflyUi");
		expect(nextValue(ui, "false").value).toBe("true");
		expect(nextValue(ui, "true").value).toBe("false");

		const notify = row("notify.enabled");
		expect(nextValue(notify, "false").value).toBe("true");
		expect(nextValue(notify, "true").value).toBe("false");

		const pad = row("outputPad");
		expect(nextValue(pad, "1").value).toBe("0");
		expect(nextValue(pad, "0").value).toBe("1");
	});

	test("starts a custom rail glyph at the first curated option", () => {
		expect(nextValue(row("chrome.rail"), "╎").value).toBe("│");
		expect(nextValue(row("chrome.rail"), "|").value).toBe(GLYPHS.divider);
	});

	test("keeps every rail option to one visible column", () => {
		for (const option of row("chrome.rail").options) {
			expect([...option.value]).toHaveLength(1);
			expect(visibleWidth(option.value)).toBe(1);
		}
	});
});

describe("stored values", () => {
	test("maps raw options to their JSON values", () => {
		expect(storedValue(row("byteflyUi"), "false")).toBe(false);
		expect(storedValue(row("byteflyUi"), "true")).toBe(true);
		expect(storedValue(row("outputPad"), "0")).toBe(0);
		expect(storedValue(row("outputPad"), "1")).toBe(1);
		expect(storedValue(row("notify.enabled"), "true")).toBe(true);
		expect(storedValue(row("chrome.rail"), "│")).toBe("│");
	});

	test("accepts only curated options", () => {
		expect(validValue(row("byteflyUi"), "true")).toBe(true);
		expect(validValue(row("byteflyUi"), "maybe")).toBe(false);
		expect(validValue(row("notify.enabled"), "1")).toBe(false);
	});
});
