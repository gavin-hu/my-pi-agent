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
	textError,
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

/** The `bytefly.json` document that states one row's leaf, for a read test. */
function documentFor(row: SettingDescriptor, value: unknown): Record<string, unknown> {
	const config = row.config;
	if (!config) return {};
	let patch: unknown = value;
	for (const key of [...config.path].reverse()) patch = { [key]: patch };
	return { [config.section]: patch };
}

describe("catalogue", () => {
	test("lists the curated rows in screen order", () => {
		expect(SETTING_ROWS.map((entry) => entry.id)).toEqual([
			"byteflyUi",
			"notify.enabled",
			"notify.method",
			"notify.title",
			"doctor.proactive",
			"price.currency.symbol",
			"price.currency.decimals",
			"price.fallbackToRecordedCost",
			"chrome.rail",
			"outputPad",
			"showHardwareCursor",
		]);
	});

	test("shows app rows only in Global scope", () => {
		expect(rowsForScope("global").map((entry) => entry.id)).toEqual([
			"byteflyUi",
			"notify.enabled",
			"notify.method",
			"notify.title",
			"doctor.proactive",
			"price.currency.symbol",
			"price.currency.decimals",
			"price.fallbackToRecordedCost",
			"chrome.rail",
			"outputPad",
			"showHardwareCursor",
		]);
		expect(rowsForScope("project").map((entry) => entry.id)).toEqual([
			"notify.enabled",
			"notify.method",
			"notify.title",
			"doctor.proactive",
			"price.currency.symbol",
			"price.currency.decimals",
			"price.fallbackToRecordedCost",
			"chrome.rail",
		]);
		expect(countSettings("global")).toBe(11);
		expect(countSettings("project")).toBe(8);
	});

	test("orders the groups and drops an empty one", () => {
		expect(SETTING_GROUPS.map((group) => group.key)).toEqual([
			"startup",
			"notifications",
			"diagnostics",
			"pricing",
			"transcript",
			"terminal",
		]);
		const grouped = groupViews(settingViews(snapshot(), "global"));
		expect(grouped.map((group) => group.views.length)).toEqual([1, 3, 1, 3, 2, 1]);

		const project = groupViews(settingViews(snapshot(), "project"));
		expect(project.map((group) => group.key)).toEqual(["notifications", "diagnostics", "pricing", "transcript"]);
		expect(project.map((group) => group.views.length)).toEqual([3, 1, 3, 1]);
	});
});

describe("values", () => {
	test("reads the defaults when neither file sets a key", () => {
		const global = settingViews(snapshot(), "global");
		expect(global.map((entry) => [entry.id, entry.value, entry.valueLabel, entry.origin])).toEqual([
			["byteflyUi", "false", "Off", "default"],
			["notify.enabled", "false", "Off", "default"],
			["notify.method", "auto", "Auto", "default"],
			["notify.title", "Pi", "Pi", "default"],
			["doctor.proactive", "true", "On", "default"],
			["price.currency.symbol", "¥", "¥", "default"],
			["price.currency.decimals", "2", "2", "default"],
			["price.fallbackToRecordedCost", "true", "On", "default"],
			["chrome.rail", GLYPHS.divider, GLYPHS.divider, "default"],
			["outputPad", "1", "1", "default"],
			["showHardwareCursor", "false", "Off", "default"],
		]);

		const project = settingViews(snapshot(), "project");
		expect(project.map((entry) => entry.origin)).toEqual([
			"inherited",
			"inherited",
			"inherited",
			"inherited",
			"inherited",
			"inherited",
			"inherited",
			"inherited",
		]);
	});

	test("reads configured app and bytefly values", () => {
		const snap = snapshot({
			app: { quietStartup: true, outputPad: 0, showHardwareCursor: true } as Settings,
			global: {
				notify: { enabled: true, method: "osc99" },
				chrome: { rail: "│" },
				doctor: { proactive: false },
				price: { currency: { symbol: "$", decimals: 4 }, fallbackToRecordedCost: false },
			},
		});

		expect(view("byteflyUi", "global", snap).valueLabel).toBe("On");
		expect(view("byteflyUi", "global", snap).origin).toBe("global");
		expect(view("notify.enabled", "global", snap).valueLabel).toBe("On");
		expect(view("notify.enabled", "global", snap).origin).toBe("global");
		expect(view("notify.method", "global", snap).valueLabel).toBe("OSC 99");
		expect(view("doctor.proactive", "global", snap).valueLabel).toBe("Off");
		expect(view("price.currency.decimals", "global", snap).value).toBe("4");
		expect(view("price.fallbackToRecordedCost", "global", snap).valueLabel).toBe("Off");
		expect(view("chrome.rail", "global", snap).value).toBe("│");
		expect(view("outputPad", "global", snap).value).toBe("0");
		expect(view("showHardwareCursor", "global", snap).valueLabel).toBe("On");
	});

	test("clamps a nested value the loader would clamp", () => {
		const snap = snapshot({ global: { price: { currency: { decimals: 9 } } } });

		expect(view("price.currency.decimals", "global", snap).value).toBe("4");
		expect(view("price.currency.decimals", "global", snap).origin).toBe("global");
	});

	test("reads a hand-set header-only startup as bytefly UI off", () => {
		const snap = snapshot({ app: { quietStartup: "header" } as Settings });

		expect(view("byteflyUi", "global", snap).valueLabel).toBe("Off");
		expect(view("byteflyUi", "global", snap).origin).toBe("global");
	});

	test("inherits the global value in Project scope until a project key overrides it", () => {
		const snap = snapshot({
			global: { notify: { enabled: true }, chrome: { rail: "│" }, price: { currency: { decimals: 2 } } },
			project: { notify: { enabled: false }, price: { currency: { decimals: 3 } } },
		});

		expect(view("notify.enabled", "project", snap).valueLabel).toBe("Off");
		expect(view("notify.enabled", "project", snap).origin).toBe("project");
		expect(view("price.currency.decimals", "project", snap).value).toBe("3");
		expect(view("price.currency.decimals", "project", snap).origin).toBe("project");
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

	test("cycles the delivery method through every surface and wraps", () => {
		const method = row("notify.method");
		expect(nextValue(method, "auto").value).toBe("osc777");
		expect(nextValue(method, "notify-send").value).toBe("auto");
	});

	test("cycles the cost precision and wraps at the top of the range", () => {
		const decimals = row("price.currency.decimals");
		expect(nextValue(decimals, "2").value).toBe("3");
		expect(nextValue(decimals, "4").value).toBe("0");
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
		expect(storedValue(row("notify.method"), "osc99")).toBe("osc99");
		expect(storedValue(row("price.currency.decimals"), "3")).toBe(3);
		expect(storedValue(row("chrome.rail"), "│")).toBe("│");
	});

	test("declares a JSON type for every boolean row", () => {
		for (const entry of SETTING_ROWS.filter((candidate) => candidate.kind === "boolean")) {
			expect(entry.json).toBe("boolean");
			expect(entry.options.map((option) => option.value)).toEqual(["false", "true"]);
		}
	});

	test("round-trips every curated option through its stored value", () => {
		for (const entry of SETTING_ROWS.filter((candidate) => candidate.source === "bytefly")) {
			for (const option of entry.options) {
				const snap = snapshot({ global: documentFor(entry, storedValue(entry, option.value)) });
				const read = view(entry.id, "global", snap);
				expect([entry.id, option.value, read.value]).toEqual([entry.id, option.value, option.value]);
			}
		}
	});

	test("accepts only curated options", () => {
		expect(validValue(row("byteflyUi"), "true")).toBe(true);
		expect(validValue(row("byteflyUi"), "maybe")).toBe(false);
		expect(validValue(row("notify.enabled"), "1")).toBe(false);
	});
});

describe("text rows", () => {
	test("accepts a value inside the rule and refuses one outside it", () => {
		const title = row("notify.title");
		expect(textError(title, "Build finished")).toBeUndefined();
		expect(textError(title, "x".repeat(40))).toBeUndefined();
		expect(textError(title, "x".repeat(41))).toContain("the limit is 40");
		expect(textError(title, "   ")).toBe("A title is required.");
	});

	test("holds the symbol to the length the loader slices to", () => {
		const symbol = row("price.currency.symbol");
		expect(textError(symbol, "$")).toBeUndefined();
		expect(textError(symbol, "CHF")).toBeUndefined();
		expect(textError(symbol, "$US$")).toBeUndefined();
		expect(textError(symbol, "$USD$")).toContain("the limit is 4");
		expect(textError(symbol, "")).toBe("A symbol is required.");
	});

	test("refuses to treat a cycling row as text", () => {
		expect(textError(row("notify.enabled"), "true")).toContain("is not a text setting");
	});

	test("keeps the current value when a text row is asked for its next one", () => {
		expect(nextValue(row("notify.title"), "Pinned").value).toBe("Pinned");
	});

	test("reads a stored title and symbol from the document", () => {
		const snap = snapshot({ global: { notify: { title: "Pinned" }, price: { currency: { symbol: "$" } } } });

		expect(view("notify.title", "global", snap).value).toBe("Pinned");
		expect(view("notify.title", "global", snap).origin).toBe("global");
		expect(view("price.currency.symbol", "global", snap).value).toBe("$");
	});
});
