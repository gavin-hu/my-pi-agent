import { describe, expect, test } from "bun:test";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { isRailGlyph } from "../chrome.ts";
import { DEFAULT_CONFIG as DEFAULT_DOCTOR_CONFIG } from "../doctor/config.ts";
import type { Settings, WriteScope } from "../picker/types.ts";
import {
	SETTING_GROUPS,
	SETTING_ROWS,
	groupViews,
	nextValue,
	rowsForScope,
	type SettingDescriptor,
	settingViews,
	type SettingsSnapshot,
	storedValue,
	textError,
} from "./settings.ts";

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
			"notify.enabled",
			"notify.turnFinished",
			"notify.needsInput",
			"notify.jobFinished",
			"notify.matchFound",
			"notify.method",
			"notify.title",
			"doctor.proactive",
			"doctor.timeoutMs",
			"price.currency.code",
			"price.currency.decimals",
			"price.budget",
			"chrome.rail",
			"goal.achieved",
			"outputPad",
			"theme",
			"showHardwareCursor",
			"worktree.baseRef",
			"worktree.branchPrefix",
			"worktree.fetchRemote",
			"worktree.pruneAfterDays",
			"rewind.autoSnapshots",
			"rewind.max",
			"rewind.safetySnapshot",
			"job.wakeOnFinish",
			"job.detachedByDefault",
			"watch.wakeOnMatch",
			"memory.inject",
		]);
	});

	test("shows app rows only in Global scope", () => {
		expect(rowsForScope("global").map((entry) => entry.id)).toEqual([
			"byteflyUi",
			"notify.enabled",
			"notify.turnFinished",
			"notify.needsInput",
			"notify.jobFinished",
			"notify.matchFound",
			"notify.method",
			"notify.title",
			"doctor.proactive",
			"doctor.timeoutMs",
			"price.currency.code",
			"price.currency.decimals",
			"price.budget",
			"chrome.rail",
			"goal.achieved",
			"outputPad",
			"theme",
			"showHardwareCursor",
			"worktree.baseRef",
			"worktree.branchPrefix",
			"worktree.fetchRemote",
			"worktree.pruneAfterDays",
			"rewind.autoSnapshots",
			"rewind.max",
			"rewind.safetySnapshot",
			"job.wakeOnFinish",
			"job.detachedByDefault",
			"watch.wakeOnMatch",
			"memory.inject",
		]);
		// Every `bytefly.json` row is writable in Project scope; the three Pi rows
		// have no project setter.
		expect(rowsForScope("project").map((entry) => entry.id)).toEqual(
			rowsForScope("global")
				.filter((entry) => entry.source === "bytefly")
				.map((entry) => entry.id),
		);
		expect(rowsForScope("global")).toHaveLength(29);
		expect(rowsForScope("project")).toHaveLength(25);
	});

	test("orders the groups and drops an empty one", () => {
		expect(SETTING_GROUPS.map((group) => group.key)).toEqual([
			"startup",
			"notifications",
			"diagnostics",
			"pricing",
			"transcript",
			"terminal",
			"worktree",
			"snapshots",
			"jobs",
			"memory",
		]);
		const grouped = groupViews(settingViews(snapshot(), "global"));
		expect(grouped.map((group) => group.views.length)).toEqual([1, 7, 2, 3, 3, 2, 4, 3, 3, 1]);

		const project = groupViews(settingViews(snapshot(), "project"));
		expect(project.map((group) => group.key)).toEqual([
			"notifications",
			"diagnostics",
			"pricing",
			"transcript",
			"worktree",
			"snapshots",
			"jobs",
			"memory",
		]);
		expect(project.map((group) => group.views.length)).toEqual([7, 2, 3, 2, 4, 3, 3, 1]);
	});
});

describe("values", () => {
	test("reads the defaults when neither file sets a key", () => {
		const global = settingViews(snapshot(), "global");
		expect(global.map((entry) => [entry.id, entry.value, entry.valueLabel, entry.origin])).toEqual([
			["byteflyUi", "false", "Off", "default"],
			["notify.enabled", "false", "Off", "default"],
			["notify.turnFinished", "true", "On", "default"],
			["notify.needsInput", "true", "On", "default"],
			["notify.jobFinished", "true", "On", "default"],
			["notify.matchFound", "true", "On", "default"],
			["notify.method", "auto", "Auto", "default"],
			["notify.title", "Pi", "Pi", "default"],
			["doctor.proactive", "true", "On", "default"],
			["doctor.timeoutMs", "2000", "2000", "default"],
			["price.currency.code", "CNY", "CNY (¥)", "default"],
			["price.currency.decimals", "2", "2", "default"],
			["price.budget", "0", "0", "default"],
			["chrome.rail", GLYPHS.divider, GLYPHS.divider, "default"],
			["goal.achieved", "hide", "Hide", "default"],
			["outputPad", "1", "1", "default"],
			["theme", "system", "system", "default"],
			["showHardwareCursor", "false", "Off", "default"],
			["worktree.baseRef", "fresh", "Fresh", "default"],
			["worktree.branchPrefix", "worktree-", "worktree-", "default"],
			["worktree.fetchRemote", "true", "On", "default"],
			["worktree.pruneAfterDays", "7", "7", "default"],
			["rewind.autoSnapshots", "true", "On", "default"],
			["rewind.max", "20", "20", "default"],
			["rewind.safetySnapshot", "true", "On", "default"],
			["job.wakeOnFinish", "false", "Off", "default"],
			["job.detachedByDefault", "false", "Off", "default"],
			["watch.wakeOnMatch", "false", "Off", "default"],
			["memory.inject", "true", "On", "default"],
		]);

		const project = settingViews(snapshot(), "project");
		expect(project.map((entry) => entry.origin)).toEqual(Array.from({ length: 25 }, () => "default"));

		const inherited = snapshot({ global: { notify: { enabled: true } } });
		expect(view("notify.enabled", "project", inherited)).toMatchObject({ value: "true", origin: "inherited" });
		expect(view("notify.needsInput", "project", inherited)).toMatchObject({ value: "true", origin: "default" });
	});

	test("lists the resolved themes and labels an automatic pair", () => {
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
			app: { quietStartup: true, outputPad: 0, showHardwareCursor: true } as Settings,
			global: {
				notify: { enabled: true, method: "osc99" },
				chrome: { rail: "│" },
				doctor: { proactive: false },
				price: { currency: { decimals: 4 } },
			},
		});

		expect(view("byteflyUi", "global", snap).valueLabel).toBe("On");
		expect(view("byteflyUi", "global", snap).origin).toBe("global");
		expect(view("notify.enabled", "global", snap).valueLabel).toBe("On");
		expect(view("notify.enabled", "global", snap).origin).toBe("global");
		expect(view("notify.method", "global", snap).valueLabel).toBe("OSC 99");
		expect(view("doctor.proactive", "global", snap).valueLabel).toBe("Off");
		expect(view("price.currency.decimals", "global", snap).value).toBe("4");
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

	test("leaves the rail glyph alone: it is typed, not cycled", () => {
		expect(nextValue(row("chrome.rail"), "╎").value).toBe("╎");
		expect(nextValue(row("chrome.rail"), "|").value).toBe("|");
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

	test("cycles the theme through the names the host resolved", () => {
		const snap = snapshot({
			themes: ["system", "dark", "light", "bytefly-dark"],
			app: { theme: "system" } as Settings,
		});
		const theme = view("theme", "global", snap);

		expect(nextValue(theme, "system").value).toBe("dark");
		expect(nextValue(theme, "bytefly-dark").value).toBe("system");
	});

	test("keeps the rail rule and the loader on one definition", () => {
		// The row's rule is `chrome.ts`'s, so what the editor accepts is what the
		// next read keeps.
		for (const glyph of [GLYPHS.divider, "│", "┃", "▏", "|", "#"]) {
			expect(isRailGlyph(glyph), glyph).toBe(true);
			expect(textError(row("chrome.rail"), glyph)).toBeUndefined();
		}
		// A space is one column and the loader accepts it, so the rule must too.
		expect(textError(row("chrome.rail"), " ")).toBeUndefined();
		for (const bad of ["", "ab", "\u001b", "あ", "😀"]) {
			expect(isRailGlyph(bad), JSON.stringify(bad)).toBe(false);
			expect(textError(row("chrome.rail"), bad), JSON.stringify(bad)).toContain("one column");
		}
	});

	test("states the probe timeout's rule at the loader's own bounds", () => {
		const timeout = row("doctor.timeoutMs");
		expect(textError(timeout, "2000")).toBeUndefined();
		expect(textError(timeout, "100")).toBeUndefined();
		expect(textError(timeout, String(DEFAULT_DOCTOR_CONFIG.timeoutMs))).toBeUndefined();
		// Exactly the range `normalizeConfig` clamps to: outside it the file would be
		// silently clamped on the next read, which is the bug this row prevents.
		expect(textError(timeout, "99")).toContain("Out of range");
		expect(textError(timeout, "30001")).toContain("Out of range");
		expect(textError(timeout, "2s")).toContain("whole number");
		expect(textError(timeout, "")).toContain("whole number");
		expect(textError(timeout, "-1")).toContain("whole number");
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
});

describe("text rows", () => {
	test("accepts a value inside the rule and refuses one outside it", () => {
		const title = row("notify.title");
		expect(textError(title, "Build finished")).toBeUndefined();
		expect(textError(title, "x".repeat(40))).toBeUndefined();
		expect(textError(title, "x".repeat(41))).toContain("the limit is 40");
		expect(textError(title, "   ")).toBe("A title is required.");
	});

	test("refuses to treat a cycling row as text", () => {
		expect(textError(row("notify.enabled"), "true")).toContain("is not a text setting");
	});

	test("keeps the current value when a text row is asked for its next one", () => {
		expect(nextValue(row("notify.title"), "Pinned").value).toBe("Pinned");
	});

	test("reads a stored title from the document", () => {
		const snap = snapshot({ global: { notify: { title: "Pinned" } } });

		expect(view("notify.title", "global", snap).value).toBe("Pinned");
		expect(view("notify.title", "global", snap).origin).toBe("global");
	});
});

describe("rows owned by other extensions", () => {
	test("reads the leaf as the file states it and labels a curated value", () => {
		const snap = snapshot({ global: { worktree: { baseRef: "head", pruneAfterDays: 30 } } });

		expect(view("worktree.baseRef", "global", snap)).toMatchObject({
			value: "head",
			valueLabel: "Head",
			origin: "global",
		});
		expect(view("worktree.pruneAfterDays", "global", snap)).toMatchObject({ value: "30", origin: "global" });
	});

	test("inherits the global leaf in Project scope until the project states it", () => {
		const snap = snapshot({ global: { rewind: { max: 50 } }, project: { rewind: { max: 5 } } });

		expect(view("rewind.max", "project", snapshot({ global: { rewind: { max: 50 } } }))).toMatchObject({
			value: "50",
			origin: "inherited",
		});
		expect(view("rewind.max", "project", snap)).toMatchObject({ value: "5", origin: "project" });
	});

	test("shows a hand-edited value the loader would clamp, which reset can clear", () => {
		// The screen does not own these normalizers, so it reports the file rather
		// than the clamped effective value; the row's own rule refuses writing one.
		const snap = snapshot({ global: { rewind: { max: 5000 } } });

		expect(view("rewind.max", "global", snap).value).toBe("5000");
		expect(textError(row("rewind.max"), "5000")).toContain("Out of range");
	});
});
