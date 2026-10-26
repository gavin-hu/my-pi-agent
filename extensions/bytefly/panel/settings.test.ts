/**
 * The Settings catalogue: the twelve curated rows, the view and origin each one
 * reports per scope, its cycling and stored-value mapping, and the theme row's
 * shortlist.
 *
 * The writer behind the rows is `settings-runtime.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import pkg from "../../../package.json";
import {
	documentFor,
	settingDescriptor,
	settingView,
	settingsSnapshot,
} from "../../../test/helpers/fixtures/bytefly.ts";
import type { Settings } from "../picker/types.ts";
import { nextValue, rowsForScope, SETTING_ROWS, settingViews, storedValue, textError } from "./settings.ts";
import { SHIPPED_THEMES_DIR, shippedThemeNames } from "./themes.ts";

describe("settings catalogue", () => {
	test("lists the curated rows in screen order and stays inside the 24-row ceiling", () => {
		expect(SETTING_ROWS.map((entry) => entry.id)).toEqual([
			"byteflyUi",
			"theme",
			"notify.enabled",
			"notify.turnFinished",
			"notify.needsInput",
			"notify.jobFinished",
			"notify.matchFound",
			"job.wakeOnFinish",
			"rewind.autoSnapshots",
			"doctor.proactive",
			"price.currency.code",
			"price.budget",
		]);
		expect(SETTING_ROWS.length).toBeLessThanOrEqual(12);
		expect(new Set(SETTING_ROWS.map((entry) => entry.id)).size).toBe(SETTING_ROWS.length);
	});

	test("shows app rows only in Global scope", () => {
		const global = rowsForScope("global").map((entry) => entry.id);
		expect(global).toEqual(SETTING_ROWS.map((entry) => entry.id));
		expect(rowsForScope("project").map((entry) => entry.id)).toEqual(
			rowsForScope("global")
				.filter((entry) => entry.config !== undefined)
				.map((entry) => entry.id),
		);
		expect(global).toHaveLength(12);
		expect(rowsForScope("project")).toHaveLength(10);
	});

	test("names every row and describes it", () => {
		for (const entry of SETTING_ROWS) {
			expect(entry.label.trim(), entry.id).not.toBe("");
			expect(entry.description.trim(), entry.id).not.toBe("");
		}
	});

	test("reads the defaults when neither file sets a key", () => {
		expect(
			settingViews(settingsSnapshot(), "global").map((entry) => [
				entry.id,
				entry.value,
				entry.valueLabel,
				entry.origin,
			]),
		).toEqual([
			["byteflyUi", "false", "Off", "default"],
			["theme", "system", "system", "default"],
			["notify.enabled", "false", "Off", "default"],
			["notify.turnFinished", "true", "On", "default"],
			["notify.needsInput", "true", "On", "default"],
			["notify.jobFinished", "true", "On", "default"],
			["notify.matchFound", "true", "On", "default"],
			["job.wakeOnFinish", "false", "Off", "default"],
			["rewind.autoSnapshots", "true", "On", "default"],
			["doctor.proactive", "true", "On", "default"],
			["price.currency.code", "CNY", "CNY (¥)", "default"],
			["price.budget", "0", "0", "default"],
		]);

		expect(settingViews(settingsSnapshot(), "project").map((entry) => entry.origin)).toEqual(
			Array.from({ length: 10 }, () => "default"),
		);
		const inherited = settingsSnapshot({ global: { notify: { enabled: true } } });
		expect(settingView(inherited, "project", "notify.enabled")).toMatchObject({ value: "true", origin: "inherited" });
		expect(settingView(inherited, "project", "notify.needsInput")).toMatchObject({ value: "true", origin: "default" });
	});

	test("lists the theme names it is given and labels an automatic pair", () => {
		const themes = ["system", "bytefly-dark", "dark", "light"];
		const fixed = settingsSnapshot({ themes, app: { theme: "bytefly-dark" } as Settings });
		expect(settingView(fixed, "global", "theme")).toMatchObject({
			value: "bytefly-dark",
			valueLabel: "bytefly-dark",
			origin: "global",
		});
		expect(settingView(fixed, "global", "theme").options.map((option) => option.value)).toEqual(themes);

		const automatic = settingsSnapshot({ themes, app: { theme: "light/dark" } as Settings });
		expect(settingView(automatic, "global", "theme")).toMatchObject({
			value: "light/dark",
			valueLabel: "light/dark (automatic)",
			origin: "global",
		});
	});

	test("reads configured app and bytefly values", () => {
		const snap = settingsSnapshot({
			app: { quietStartup: true } as Settings,
			global: {
				notify: { enabled: true },
				doctor: { proactive: false },
				price: { currency: { code: "USD" } },
				job: { wakeOnFinish: true },
			},
		});

		expect(settingView(snap, "global", "byteflyUi")).toMatchObject({ valueLabel: "On", origin: "global" });
		expect(settingView(snap, "global", "notify.enabled")).toMatchObject({ valueLabel: "On", origin: "global" });
		expect(settingView(snap, "global", "doctor.proactive").valueLabel).toBe("Off");
		expect(settingView(snap, "global", "price.currency.code").valueLabel).toBe("USD ($)");
		expect(settingView(snap, "global", "job.wakeOnFinish").valueLabel).toBe("On");
	});

	test("reads a hand-set header-only startup as bytefly UI off", () => {
		const snap = settingsSnapshot({ app: { quietStartup: "header" } as Settings });
		expect(settingView(snap, "global", "byteflyUi")).toMatchObject({ valueLabel: "Off", origin: "global" });
	});

	test("inherits the global value in Project scope until a project key overrides it", () => {
		const snap = settingsSnapshot({
			global: { notify: { enabled: true }, price: { currency: { code: "USD" } } },
			project: { notify: { enabled: false }, price: { currency: { code: "CNY" } } },
		});

		expect(settingView(snap, "project", "notify.enabled")).toMatchObject({ valueLabel: "Off", origin: "project" });
		expect(settingView(snap, "project", "price.currency.code")).toMatchObject({ value: "CNY", origin: "project" });
		expect(
			settingView(
				settingsSnapshot({ global: { rewind: { autoSnapshots: false } } }),
				"project",
				"rewind.autoSnapshots",
			),
		).toMatchObject({ value: "false", origin: "inherited" });
	});

	test("shows the loader fallback for an invalid stored value", () => {
		const snap = settingsSnapshot({ global: { notify: { enabled: "yes" } } });
		expect(settingView(snap, "global", "notify.enabled")).toMatchObject({ valueLabel: "Off", origin: "global" });
	});

	test("wraps each row through its curated options", () => {
		expect(nextValue(settingDescriptor("byteflyUi"), "false").value).toBe("true");
		expect(nextValue(settingDescriptor("byteflyUi"), "true").value).toBe("false");
		expect(nextValue(settingDescriptor("notify.enabled"), "false").value).toBe("true");
		expect(nextValue(settingDescriptor("notify.enabled"), "true").value).toBe("false");
		expect(nextValue(settingDescriptor("price.currency.code"), "CNY").value).toBe("USD");
		expect(nextValue(settingDescriptor("price.currency.code"), "USD").value).toBe("CNY");
	});

	test("cycles a boolean row through both values and wraps", () => {
		const row = settingDescriptor("job.wakeOnFinish");
		expect(nextValue(row, "true").value).toBe("false");
		expect(nextValue(row, "false").value).toBe("true");
	});

	test("cycles the theme through the names it is given", () => {
		const snap = settingsSnapshot({ themes: ["system", "dark", "light", "bytefly-dark"], app: { theme: "system" } });
		const theme = settingView(snap, "global", "theme");
		expect(nextValue(theme, "system").value).toBe("dark");
		expect(nextValue(theme, "bytefly-dark").value).toBe("system");
	});

	test("keeps the current value when a text row is asked for its next one", () => {
		expect(nextValue(settingDescriptor("price.budget"), "Pinned").value).toBe("Pinned");
	});

	test("states the budget's rule with the loader's own bounds", () => {
		const budget = settingDescriptor("price.budget");
		for (const good of ["0", "5", "2.50", "0.0001", "9999999"]) {
			expect(textError(budget, good), good).toBeUndefined();
		}
		for (const bad of ["", "-1", "5.", ".5", "5.00001", "10000001", "ten"]) {
			expect(textError(budget, bad), bad).toBeDefined();
		}
	});

	test("every text row's fallback passes its own rule", () => {
		for (const entry of SETTING_ROWS) {
			if (entry.kind !== "text") continue;
			expect(textError(entry, entry.fallback), entry.id).toBeUndefined();
		}
	});

	test("refuses to treat a cycling row as text", () => {
		expect(textError(settingDescriptor("notify.enabled"), "true")).toContain("is not a text setting");
	});

	test("maps raw options to their JSON values", () => {
		expect(storedValue(settingDescriptor("byteflyUi"), "false")).toBe(false);
		expect(storedValue(settingDescriptor("byteflyUi"), "true")).toBe(true);
		expect(storedValue(settingDescriptor("notify.enabled"), "true")).toBe(true);
		expect(storedValue(settingDescriptor("price.budget"), "3")).toBe(3);
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
				const snap = settingsSnapshot({ global: documentFor(entry, storedValue(entry, option.value)) });
				expect(settingView(snap, "global", entry.id).value, `${entry.id}=${option.value}`).toBe(option.value);
			}
		}
	});

	test("reads a stored budget from the document", () => {
		const snap = settingsSnapshot({ global: { price: { budget: 5 } } });
		expect(settingView(snap, "global", "price.budget")).toMatchObject({ value: "5", origin: "global" });
	});

	test("reads another extension's leaf as the file states it and labels a curated value", () => {
		const snap = settingsSnapshot({
			global: { rewind: { autoSnapshots: false }, job: { wakeOnFinish: true } },
		});
		expect(settingView(snap, "global", "rewind.autoSnapshots")).toMatchObject({
			value: "false",
			valueLabel: "Off",
			origin: "global",
		});
		expect(settingView(snap, "global", "job.wakeOnFinish")).toMatchObject({ value: "true", origin: "global" });
	});

	test("inherits another extension's global leaf in Project scope until the project states it", () => {
		const inherited = settingsSnapshot({ global: { job: { wakeOnFinish: true } } });
		expect(settingView(inherited, "project", "job.wakeOnFinish")).toMatchObject({
			value: "true",
			origin: "inherited",
		});
		const overridden = settingsSnapshot({
			global: { job: { wakeOnFinish: true } },
			project: { job: { wakeOnFinish: false } },
		});
		expect(settingView(overridden, "project", "job.wakeOnFinish")).toMatchObject({
			value: "false",
			origin: "project",
		});
	});

	test("shows a hand-edited value the loader would clamp, which reset can clear", () => {
		const snap = settingsSnapshot({ global: { job: { wakeOnFinish: "yes" } } });
		expect(settingView(snap, "global", "job.wakeOnFinish")).toMatchObject({ value: "yes", valueLabel: "yes" });
	});
});

describe("shipped themes", () => {
	function shipped(name: string): { name: string; path: string } {
		return { name, path: join(SHIPPED_THEMES_DIR, `${name}.json`) };
	}

	test("keeps this package's palettes and drops every other theme", () => {
		const names = shippedThemeNames([
			{ name: "dark", path: "/pi/themes/dark.json" },
			shipped("bytefly-dark"),
			{ name: "bytefly-light" },
			{ name: "mine", path: "/home/me/.pi/agent/themes/mine.json" },
			shipped("bytefly-light"),
			{ name: "bytefly-dark", path: "/pkg/node_modules/bytefly/themes/bytefly-dark.json" },
		]);

		expect(names).toEqual(["bytefly-dark", "bytefly-light"]);
	});

	test("matches the directory, not the name, so a look-alike stays out", () => {
		expect(
			shippedThemeNames([
				{ name: "bytefly-dark", path: join(SHIPPED_THEMES_DIR, "vendor", "bytefly-dark.json") },
				{ name: "bytefly", path: SHIPPED_THEMES_DIR },
			]),
		).toEqual([]);
	});

	test("resolves the package's own themes directory and the manifest glob", () => {
		expect(pkg.pi.themes).toEqual(["./themes/*.json"]);
		const names = shippedThemeNames(["bytefly-dark", "bytefly-light"].map((name) => shipped(name)));
		expect(names).toEqual(["bytefly-dark", "bytefly-light"]);
	});
});
