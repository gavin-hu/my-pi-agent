import { describe, expect, test } from "bun:test";
import type { Settings } from "../picker/types.ts";
import type { WriteScope } from "../picker/types.ts";
import {
	nextValue,
	rowsForScope,
	type SettingDescriptor,
	settingViews,
	type SettingsSnapshot,
	storedValue,
	textError,
} from "./settings.ts";
import { SETTING_ROWS } from "./settings.ts";

function snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
	return {
		app: overrides.app ?? {},
		global: overrides.global ?? {},
		project: overrides.project ?? {},
		themes: overrides.themes ?? [],
	};
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
			"theme",
			"notify.enabled",
			"notify.turnFinished",
			"notify.needsInput",
			"notify.jobFinished",
			"notify.matchFound",
			"notify.method",
			"job.wakeOnFinish",
			"watch.wakeOnMatch",
			"rewind.autoSnapshots",
			"doctor.proactive",
			"price.currency.code",
			"price.budget",
		]);
	});

	test("stays inside the rows a 24-row terminal can show", () => {
		// The frame spends six rows around the body and a four-line detail block
		// (three lines plus the blank above them), so fourteen rows is exactly a
		// 24-row terminal. A fifteenth would need a range row there, which is the
		// growth this ceiling exists to stop: adding a setting means removing one.
		expect(SETTING_ROWS.length).toBeLessThanOrEqual(14);
		expect(new Set(SETTING_ROWS.map((entry) => entry.id)).size).toBe(SETTING_ROWS.length);
	});

	test("shows app rows only in Global scope", () => {
		const global = rowsForScope("global").map((entry) => entry.id);
		expect(global).toEqual(SETTING_ROWS.map((entry) => entry.id));
		// Every `bytefly.json` row is writable in Project scope; the two Pi rows have
		// no project setter.
		expect(rowsForScope("project").map((entry) => entry.id)).toEqual(
			rowsForScope("global")
				.filter((entry) => entry.source === "bytefly")
				.map((entry) => entry.id),
		);
		expect(global).toHaveLength(14);
		expect(rowsForScope("project")).toHaveLength(12);
	});

	test("names every row and describes it", () => {
		for (const entry of SETTING_ROWS) {
			expect(entry.label.trim(), entry.id).not.toBe("");
			expect(entry.description.trim(), entry.id).not.toBe("");
		}
	});
});

describe("values", () => {
	test("reads the defaults when neither file sets a key", () => {
		const global = settingViews(snapshot(), "global");
		expect(global.map((entry) => [entry.id, entry.value, entry.valueLabel, entry.origin])).toEqual([
			["byteflyUi", "false", "Off", "default"],
			["theme", "system", "system", "default"],
			["notify.enabled", "false", "Off", "default"],
			["notify.turnFinished", "true", "On", "default"],
			["notify.needsInput", "true", "On", "default"],
			["notify.jobFinished", "true", "On", "default"],
			["notify.matchFound", "true", "On", "default"],
			["notify.method", "auto", "Auto", "default"],
			["job.wakeOnFinish", "false", "Off", "default"],
			["watch.wakeOnMatch", "false", "Off", "default"],
			["rewind.autoSnapshots", "true", "On", "default"],
			["doctor.proactive", "true", "On", "default"],
			["price.currency.code", "CNY", "CNY (¥)", "default"],
			["price.budget", "0", "0", "default"],
		]);

		const project = settingViews(snapshot(), "project");
		expect(project.map((entry) => entry.origin)).toEqual(Array.from({ length: 12 }, () => "default"));

		const inherited = snapshot({ global: { notify: { enabled: true } } });
		expect(view("notify.enabled", "project", inherited)).toMatchObject({ value: "true", origin: "inherited" });
		expect(view("notify.needsInput", "project", inherited)).toMatchObject({ value: "true", origin: "default" });
	});

	test("lists the theme names it is given and labels an automatic pair", () => {
		const themes = ["system", "bytefly-dark", "dark", "light"];
		const fixed = snapshot({ themes, app: { theme: "bytefly-dark" } as Settings });
		expect(view("theme", "global", fixed)).toMatchObject({
			value: "bytefly-dark",
			valueLabel: "bytefly-dark",
			origin: "global",
		});
		expect(view("theme", "global", fixed).options.map((option) => option.value)).toEqual(themes);

		const automatic = snapshot({ themes, app: { theme: "light/dark" } as Settings });
		expect(view("theme", "global", automatic)).toMatchObject({
			value: "light/dark",
			valueLabel: "light/dark (automatic)",
			origin: "global",
		});
	});

	test("reads configured app and bytefly values", () => {
		const snap = snapshot({
			app: { quietStartup: true } as Settings,
			global: {
				notify: { enabled: true, method: "osc99" },
				doctor: { proactive: false },
				price: { currency: { code: "USD" } },
				job: { wakeOnFinish: true },
			},
		});

		expect(view("byteflyUi", "global", snap).valueLabel).toBe("On");
		expect(view("byteflyUi", "global", snap).origin).toBe("global");
		expect(view("notify.enabled", "global", snap).valueLabel).toBe("On");
		expect(view("notify.enabled", "global", snap).origin).toBe("global");
		expect(view("notify.method", "global", snap).valueLabel).toBe("OSC 99");
		expect(view("doctor.proactive", "global", snap).valueLabel).toBe("Off");
		expect(view("price.currency.code", "global", snap).valueLabel).toBe("USD ($)");
		expect(view("job.wakeOnFinish", "global", snap).valueLabel).toBe("On");
	});

	test("reads a hand-set header-only startup as bytefly UI off", () => {
		const snap = snapshot({ app: { quietStartup: "header" } as Settings });

		expect(view("byteflyUi", "global", snap).valueLabel).toBe("Off");
		expect(view("byteflyUi", "global", snap).origin).toBe("global");
	});

	test("inherits the global value in Project scope until a project key overrides it", () => {
		const snap = snapshot({
			global: { notify: { enabled: true }, price: { currency: { code: "USD" } } },
			project: { notify: { enabled: false }, price: { currency: { code: "CNY" } } },
		});

		expect(view("notify.enabled", "project", snap).valueLabel).toBe("Off");
		expect(view("notify.enabled", "project", snap).origin).toBe("project");
		expect(view("price.currency.code", "project", snap).value).toBe("CNY");
		expect(view("price.currency.code", "project", snap).origin).toBe("project");
		expect(
			view("rewind.autoSnapshots", "project", snapshot({ global: { rewind: { autoSnapshots: false } } })),
		).toMatchObject({ value: "false", origin: "inherited" });
	});

	test("shows the loader fallback for an invalid stored value", () => {
		const snap = snapshot({ global: { notify: { enabled: "yes" } } });

		expect(view("notify.enabled", "global", snap).valueLabel).toBe("Off");
		expect(view("notify.enabled", "global", snap).origin).toBe("global");
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

		const currency = row("price.currency.code");
		expect(nextValue(currency, "CNY").value).toBe("USD");
		expect(nextValue(currency, "USD").value).toBe("CNY");
	});

	test("cycles the delivery method through every surface and wraps", () => {
		const method = row("notify.method");
		expect(nextValue(method, "auto").value).toBe("osc777");
		expect(nextValue(method, "notify-send").value).toBe("auto");
	});

	test("cycles the theme through the names it is given", () => {
		const snap = snapshot({
			themes: ["system", "dark", "light", "bytefly-dark"],
			app: { theme: "system" } as Settings,
		});
		const theme = view("theme", "global", snap);

		expect(nextValue(theme, "system").value).toBe("dark");
		expect(nextValue(theme, "bytefly-dark").value).toBe("system");
	});

	test("keeps the current value when a text row is asked for its next one", () => {
		expect(nextValue(row("price.budget"), "Pinned").value).toBe("Pinned");
	});

	test("states the budget's rule with the loader's own bounds", () => {
		const budget = row("price.budget");
		for (const good of ["0", "5", "2.50", "0.0001", "9999999"]) {
			expect(textError(budget, good), good).toBeUndefined();
		}
		for (const bad of ["", "-1", "5.", ".5", "5.00001", "10000001", "ten"]) {
			expect(textError(budget, bad), bad).toBeDefined();
		}
	});

	test("every row's fallback passes its own rule", () => {
		for (const entry of SETTING_ROWS) {
			if (entry.kind !== "text") continue;
			expect(textError(entry, entry.fallback), entry.id).toBeUndefined();
		}
	});
});

describe("stored values", () => {
	test("maps raw options to their JSON values", () => {
		expect(storedValue(row("byteflyUi"), "false")).toBe(false);
		expect(storedValue(row("byteflyUi"), "true")).toBe(true);
		expect(storedValue(row("notify.enabled"), "true")).toBe(true);
		expect(storedValue(row("notify.method"), "osc99")).toBe("osc99");
		expect(storedValue(row("price.budget"), "3")).toBe(3);
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
});

describe("text rows", () => {
	test("refuses to treat a cycling row as text", () => {
		expect(textError(row("notify.enabled"), "true")).toContain("is not a text setting");
	});

	test("reads a stored budget from the document", () => {
		const snap = snapshot({ global: { price: { budget: 5 } } });

		expect(view("price.budget", "global", snap).value).toBe("5");
		expect(view("price.budget", "global", snap).origin).toBe("global");
	});
});

describe("rows owned by other extensions", () => {
	test("reads the leaf as the file states it and labels a curated value", () => {
		const snap = snapshot({ global: { rewind: { autoSnapshots: false }, job: { wakeOnFinish: true } } });

		expect(view("rewind.autoSnapshots", "global", snap)).toMatchObject({
			value: "false",
			valueLabel: "Off",
			origin: "global",
		});
		expect(view("job.wakeOnFinish", "global", snap)).toMatchObject({ value: "true", origin: "global" });
	});

	test("inherits the global leaf in Project scope until the project states it", () => {
		const snap = snapshot({ global: { job: { wakeOnFinish: true } }, project: { job: { wakeOnFinish: false } } });

		expect(view("job.wakeOnFinish", "project", snapshot({ global: { job: { wakeOnFinish: true } } }))).toMatchObject({
			value: "true",
			origin: "inherited",
		});
		expect(view("job.wakeOnFinish", "project", snap)).toMatchObject({ value: "false", origin: "project" });
	});

	test("shows a hand-edited value the loader would clamp, which reset can clear", () => {
		// The screen does not own these normalizers, so it reports the file rather
		// than the clamped effective value; the row's own toggle replaces it.
		const snap = snapshot({ global: { job: { wakeOnFinish: "yes" } } });

		expect(view("job.wakeOnFinish", "global", snap).value).toBe("yes");
		expect(view("job.wakeOnFinish", "global", snap).valueLabel).toBe("yes");
	});
});
