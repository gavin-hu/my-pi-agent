/**
 * What one row says, and what the focused row's block says under or beside it:
 * the resource row grammar both list sections share, the settings row with its
 * value column, and `sideRows` — the facts, findings, and stored document the
 * list row cannot carry.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import {
	documentFor,
	enabledItem,
	findRow,
	settingDescriptor,
	settingView,
	settingsSnapshot,
	skillIndex,
	textModel,
} from "../../../test/helpers/fixtures/bytefly.ts";
import type { PanelRow } from "./types.ts";
import { resourceRow, verdictColumn } from "./tui/list-view.ts";
import { editHints, projectNote, settingLabelColumn, settingRow } from "./tui/settings-view.ts";
import { sideRows } from "./tui/side-pane.ts";

const PATHS = { scope: "global" as const, cwd: "/proj", agentDir: "/agent" };

/** The block for one row, at the width a side pane would give it. */
function block(row: PanelRow | undefined, options: { dirty?: boolean; expanded?: boolean; width?: number } = {}) {
	return sideRows({
		theme: fakeTheme,
		width: options.width ?? 46,
		section: "extensions",
		row,
		groupLabel: "npm:pkg (user)",
		help: false,
		expanded: options.expanded ?? false,
		dirty: options.dirty ?? false,
		paths: PATHS,
	});
}

describe("the resource row", () => {
	const model = textModel();

	test("draws the checkbox, the verdict glyph, the name, and the verdict", () => {
		const line = resourceRow(fakeTheme, 80, findRow(model, "plan"), false, 12);

		expect(line).toContain("◼");
		expect(line).toContain(GLYPHS.cross);
		expect(line).toContain("plan");
		expect(line).toContain("1 missing");
	});

	test("names the extension rather than its file", () => {
		expect(findRow(model, "plan").label).toBe("plan");
		expect(resourceRow(fakeTheme, 80, findRow(model, "plan"), false)).not.toContain("index.ts");
	});

	test("accents the focused name and dims a disabled one", () => {
		const focused = resourceRow(coloringTheme, 80, findRow(model, "plan"), true, 12);
		const disabled = resourceRow(coloringTheme, 80, findRow(model, "memory"), false, 12);

		expect(focused).toContain("[accent]");
		expect(focused).toContain("plan");
		expect(disabled).toContain("◻");
		expect(disabled).toContain("off");
	});

	test("reserves the checkbox column for a report with no item", () => {
		const onlyReport: PanelRow = {
			key: "report:ghost",
			report: { extension: "ghost", enabled: true, findings: [] } as unknown as PanelRow["report"],
			label: "ghost",
			group: "reported-only",
		};
		const line = resourceRow(fakeTheme, 80, onlyReport, false);

		expect(line).toContain("ghost");
		expect(line).not.toContain("◼");
	});

	test("keeps a clean row quiet and gives the verdict a column of its own", () => {
		const clean = findRow(model, "todo");
		const verdicts = verdictColumn(model.rows);

		expect(resourceRow(fakeTheme, 80, clean, false, verdicts)).not.toContain(GLYPHS.cross);
		// Every verdict starts at the same column, which is what makes the column
		// readable down; the name is padded to it rather than trailed by spaces.
		expect(verdicts).toBeGreaterThan(0);
		const line = resourceRow(fakeTheme, 80, findRow(model, "plan"), false, verdicts);
		expect(line).toContain("plan");
		expect(line.indexOf("1 missing")).toBeGreaterThan(line.indexOf("plan"));
	});
});

describe("the focused row's block", () => {
	test("names the path, the source, the state, and the health", () => {
		const lines = block(findRow(textModel(), "plan")).join("\n");

		expect(lines).toContain("plan");
		expect(lines).toContain("Path");
		expect(lines).toContain("Source");
		expect(lines).toContain("npm:pkg (user)");
		expect(lines).toContain("State");
		expect(lines).toContain("enabled");
		expect(lines).toContain("Health");
		expect(lines).toContain("1 missing");
	});

	test("lists the findings with their fix", () => {
		const lines = block(findRow(textModel(), "plan")).join("\n");

		expect(lines).toContain("findings");
		expect(lines).toContain("git");
		expect(lines).toContain("install git");
	});

	test("says when the row has no report to show a path for", () => {
		const bare = textModel([enabledItem("zulu")]);
		const lines = block(findRow(bare, "zulu")).join("\n");

		expect(lines).toContain("Path");
		expect(lines).toContain("zulu");
	});

	test("keeps the saved marker while something is unsaved", () => {
		const lines = block(findRow(textModel(), "plan"), { dirty: true });

		expect(lines.join("\n")).toContain("Saved · reload to apply");
		expect(block(findRow(textModel(), "plan")).join("\n")).not.toContain("Saved");
	});

	test("gives a skill its own call, model, and problem facts", () => {
		const skills = skillIndex({
			"/agent/skills/quiet/SKILL.md": {
				name: "quiet",
				description: "Reachable by name only.",
				modelHidden: true,
			},
		});
		const items = [enabledItem("pdf"), enabledItem("quiet")];
		const row: PanelRow = {
			key: "auto:/agent/skills/quiet/SKILL.md",
			item: items[1],
			label: "quiet",
			group: "auto",
			skill: skills.get("/agent/skills/quiet/SKILL.md"),
		};
		const lines = sideRows({
			theme: fakeTheme,
			width: 46,
			section: "skills",
			row,
			help: false,
			expanded: false,
			dirty: false,
			paths: PATHS,
		}).join("\n");

		expect(lines).toContain("quiet");
		expect(lines).toContain("/skill:quiet");
		expect(lines).toContain("hidden from the model");
		expect(lines).toContain("Reachable by name only.");
	});

	test("names why Pi refused a skill file", () => {
		const row: PanelRow = {
			key: "auto:/agent/skills/broken/SKILL.md",
			item: enabledItem("broken"),
			label: "broken",
			group: "auto",
			skill: { description: "", modelHidden: false, problem: "missing description" },
		};
		const lines = sideRows({
			theme: fakeTheme,
			width: 46,
			section: "skills",
			row,
			help: false,
			expanded: false,
			dirty: false,
			paths: PATHS,
		}).join("\n");

		expect(lines).toContain("Problem");
		expect(lines).toContain("missing description");
	});

	test("keeps a long description short until the row is expanded", () => {
		const description = `${"A long sentence about the file. ".repeat(6)}`;
		const row: PanelRow = {
			key: "auto:/agent/skills/pdf/SKILL.md",
			item: enabledItem("pdf"),
			label: "pdf",
			group: "auto",
			skill: { name: "pdf", description, modelHidden: false },
		};
		const collapsed = sideRows({
			theme: fakeTheme,
			width: 46,
			section: "skills",
			row,
			help: false,
			expanded: false,
			dirty: false,
			paths: PATHS,
		});
		const expanded = sideRows({
			theme: fakeTheme,
			width: 46,
			section: "skills",
			row,
			help: false,
			expanded: true,
			dirty: false,
			paths: PATHS,
		});

		expect(collapsed.length).toBeLessThan(expanded.length);
		for (const line of [...collapsed, ...expanded]) expect(visibleWidth(line)).toBeLessThanOrEqual(46);
	});

	test("draws the key table in place of the facts when help is open", () => {
		const lines = sideRows({
			theme: fakeTheme,
			width: 60,
			section: "extensions",
			row: findRow(textModel(), "plan"),
			help: true,
			expanded: true,
			dirty: false,
			paths: PATHS,
		}).join("\n");

		expect(lines).toContain("Space");
		expect(lines).toContain("Reload to apply");
		expect(lines).not.toContain("Path");
	});
});

describe("the settings row", () => {
	const snapshot = settingsSnapshot({ app: { quietStartup: true, theme: "bytefly-dark" } });
	const views = ["byteflyUi", "theme", "notify.enabled", "price.budget"].map((id) =>
		settingView(snapshot, "global", id),
	);

	test("draws a checkbox for a boolean and no box for a text row", () => {
		const boolean = settingRow(fakeTheme, 80, settingView(snapshot, "global", "byteflyUi"), false, undefined, 0);
		const text = settingRow(fakeTheme, 80, settingView(snapshot, "global", "price.budget"), false, undefined, 0);

		expect(boolean).toContain("◼");
		expect(boolean).toContain("Startup screen");
		expect(boolean).toContain("On");
		expect(text).toContain("Session budget");
		expect(text).toContain("Off");
		expect(text).not.toContain("◻");
	});

	test("puts every value in one column, measured from the labels on screen", () => {
		const column = settingLabelColumn(views, 80);
		const lines = views.map((view, index) =>
			settingRow(fakeTheme, 80, view, index === 0, undefined, column).replace("❯ ", "  "),
		);
		const starts = lines.map((line) => line.indexOf(views[lines.indexOf(line)]?.valueLabel ?? ""));

		expect(new Set(starts).size).toBe(1);
		expect(column).toBeGreaterThan(0);
	});

	test("accents the focused row's label", () => {
		const line = settingRow(coloringTheme, 80, settingView(snapshot, "global", "theme"), true, undefined, 12);

		expect(line).toContain("[accent]");
		expect(line).toContain("Theme");
	});

	test("keeps the label and the caret while editing a long value at a narrow width", () => {
		const line = settingRow(
			fakeTheme,
			40,
			settingView(snapshot, "global", "price.budget"),
			true,
			{ buffer: "123456789012345", caret: 15 },
			12,
		);

		expect(line).toContain("Session budget");
		expect(line).toContain("▏");
		expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});

	test("notes that app settings are Global only", () => {
		expect(projectNote(fakeTheme, 80)).toContain("App settings are Global only.");
	});

	test("names the editor's keys", () => {
		expect(editHints()).toContain("Esc cancel");
		expect(editHints()).toContain("Enter save");
	});
});

describe("the settings block", () => {
	const snapshot = settingsSnapshot({
		app: { theme: "bytefly-dark" },
		global: { notify: { enabled: true } },
		project: documentFor(settingDescriptor("price.budget"), 5),
	});

	test("names the value, what it does, and where it is written", () => {
		const view = settingView(snapshot, "global", "theme");
		const lines = sideRows({
			theme: fakeTheme,
			width: 50,
			section: "settings",
			setting: view,
			help: false,
			expanded: false,
			dirty: false,
			paths: PATHS,
		}).join("\n");

		expect(lines).toContain("Theme");
		expect(lines).toContain("Now");
		expect(lines).toContain("bytefly-dark");
		expect(lines).toContain("About");
		expect(lines).toContain("Stored in");
		expect(lines).toContain("/agent/settings.json");
	});

	test("names an inherited project value and its file", () => {
		const view = settingView(snapshot, "project", "notify.enabled");
		const lines = sideRows({
			theme: fakeTheme,
			width: 60,
			section: "settings",
			setting: view,
			help: false,
			expanded: false,
			dirty: false,
			paths: { ...PATHS, scope: "project" },
		}).join("\n");

		expect(lines).toContain("Inherited from Global");
		expect(lines).toContain("/agent/bytefly.json");
	});

	test("shows the focused row's section as stored, with its scope file", () => {
		const view = settingView(snapshot, "project", "price.budget");
		const lines = sideRows({
			theme: fakeTheme,
			width: 50,
			section: "settings",
			setting: view,
			help: false,
			expanded: true,
			dirty: false,
			paths: { ...PATHS, scope: "project" },
			json: { section: "price", document: { budget: 5 } },
		}).join("\n");

		expect(lines).toContain("price");
		expect(lines).toContain('"budget": 5');
	});

	test("says when the section is not set in this scope", () => {
		const view = settingView(snapshot, "global", "doctor.proactive");
		const lines = sideRows({
			theme: fakeTheme,
			width: 50,
			section: "settings",
			setting: view,
			help: false,
			expanded: true,
			dirty: false,
			paths: PATHS,
			json: { section: "doctor", document: undefined },
		}).join("\n");

		expect(lines).toContain("Not set in this scope.");
	});

	test("keeps the saved marker while something is unsaved", () => {
		const view = settingView(snapshot, "global", "theme");
		const lines = sideRows({
			theme: fakeTheme,
			width: 50,
			section: "settings",
			setting: view,
			help: false,
			expanded: false,
			dirty: true,
			paths: PATHS,
		}).join("\n");

		expect(lines).toContain("Saved · reload to apply");
	});
});
