/**
 * The panel's three detail panes: what each section's right-hand side says about
 * the focused row, and the one-line list grammar both list sections share.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import {
	enabledItem,
	findRow,
	settingView,
	settingsSnapshot,
	skillIndex,
	textModel,
} from "../../../test/helpers/fixtures/bytefly.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { skillItem } from "../../../test/helpers/fixtures/picker.ts";
import { buildPanelModel, buildSkillModel } from "./join.ts";
import type { Settings } from "../picker/types.ts";
import { extensionDetail } from "./tui/extensions-view.ts";
import { resourceRow, resourceSummary, sectionHints } from "./tui/list-view.ts";
import {
	editHints,
	projectNote,
	sectionJsonPane,
	settingDetail,
	settingRow,
	settingsHints,
	settingsSummary,
} from "./tui/settings-view.ts";
import { skillDetail } from "./tui/skills-view.ts";

describe("extensions view", () => {
	const model = textModel([enabledItem("plan"), enabledItem("todo")]);

	test("abbreviates the summary under 72 columns", () => {
		expect(resourceSummary(fakeTheme, 96, model, "global")).toContain("2 extensions");
		expect(resourceSummary(fakeTheme, 44, model, "global")).toContain("2 ext");
		expect(resourceSummary(fakeTheme, 96, model, "global", { filter: "plan" })).toContain("plan only");
	});

	test("draws checkbox, health glyph, name, and verdict on one row", () => {
		const missing = findRow(model, "plan/index.ts");
		const clean = findRow(model, "todo/index.ts");

		expect(resourceRow(fakeTheme, 80, missing, false)).toContain(GLYPHS.boxOn);
		expect(resourceRow(fakeTheme, 80, missing, false)).toContain(GLYPHS.cross);
		expect(resourceRow(fakeTheme, 80, missing, false)).toContain("1 missing");
		expect(resourceRow(fakeTheme, 80, clean, false)).not.toContain(GLYPHS.cross);
	});

	test("accents the focused label and dims a disabled one", () => {
		const focused = resourceRow(coloringTheme, 80, findRow(model, "plan/index.ts"), true);
		const disabled = resourceRow(
			coloringTheme,
			80,
			findRow(textModel([enabledItem("plan"), enabledItem("zulu", false)]), "zulu/index.ts"),
			false,
		);

		expect(focused).toContain("[accent]plan/index.ts");
		expect(disabled).toContain("[dim]zulu/index.ts");
		expect(disabled).toContain("off");
	});

	test("reserves the checkbox column for a report with no item", () => {
		const reported = buildPanelModel({ items: [], reports: [makeReport("bytefly")], agentDir: "/agent" }).rows[0];
		if (!reported) throw new Error("expected a row");
		const line = resourceRow(fakeTheme, 80, reported, false);

		expect(line).toContain("bytefly");
		expect(line).not.toContain(GLYPHS.boxOn);
		expect(line).not.toContain(GLYPHS.boxOff);
	});

	test("keeps a clean verdict quiet and colors a problem", () => {
		const clean = findRow(
			buildPanelModel({ items: [enabledItem("todo")], reports: [makeReport("todo")], agentDir: "/agent" }),
			"todo/index.ts",
		);
		expect(resourceRow(coloringTheme, 80, clean, false)).toContain("[dim]ok");
		expect(resourceRow(coloringTheme, 80, findRow(model, "plan/index.ts"), false)).toContain("[error]1 missing");
	});

	test("shows the resource path in the detail pane for an unreported row", () => {
		const row = findRow(textModel([enabledItem("memory")]), "memory/index.ts");
		const detail = extensionDetail(fakeTheme, 80, row, 3, false, false);

		expect(detail.join("\n")).toContain("/pkg/extensions/memory/index.ts");
	});

	test("shows findings in the detail pane, with the saved marker while dirty", () => {
		const row = findRow(model, "plan/index.ts");
		const detail = extensionDetail(fakeTheme, 80, row, 3, false, true).join("\n");

		expect(detail).toContain("git");
		expect(detail).toContain("Saved · reload to apply");
	});

	test("keeps informational notes collapsed until expanded", () => {
		const row = buildPanelModel({
			items: [enabledItem("plan")],
			reports: [makeReport("plan", [makeFinding("platform", "info", "TUI only")])],
			agentDir: "/agent",
		}).rows[0];
		if (!row) throw new Error("expected a row");

		expect(extensionDetail(fakeTheme, 80, row, 4, false, false).join("\n")).not.toContain("TUI only");
		expect(extensionDetail(fakeTheme, 80, row, 4, true, false).join("\n")).toContain("TUI only");
	});

	test("hints the expansion, project override, and refresh states", () => {
		const texts = (hints: ReturnType<typeof sectionHints>): string[] =>
			hints.map((hint) => (typeof hint === "string" ? hint : hint.text));

		const collapsed = texts(sectionHints({ expanded: false, refreshing: false, projectScope: false }));
		const expanded = texts(sectionHints({ expanded: true, refreshing: true, projectScope: true }));

		expect(collapsed).toContain("Enter detail");
		expect(collapsed).not.toContain("x inherit");
		expect(collapsed).toContain("r refresh");
		expect(expanded).toContain("Enter collapse");
		expect(expanded).toContain("x inherit");
		expect(expanded).toContain("refreshing…");
	});
});

describe("skills view", () => {
	const skillsModel = (description = "Extract text and tables from PDF files.") =>
		buildSkillModel({
			items: [skillItem("pdf")],
			index: skillIndex({
				"/agent/skills/pdf/SKILL.md": { name: "pdf", description, modelHidden: false },
			}),
			agentDir: "/agent",
		});

	test("starts the pane with the file and its description", () => {
		const detail = skillDetail({
			theme: fakeTheme,
			width: 80,
			row: skillsModel().rows[0],
			budget: 3,
			expanded: false,
			dirty: false,
		}).join("\n");

		expect(detail).toContain("/agent/skills/pdf/SKILL.md");
		expect(detail).toContain("Extract text and tables from PDF files.");
	});

	test("keeps a long description to one line until expanded", () => {
		const description = `${"word ".repeat(20)}SECOND`;
		const row = skillsModel(description).rows[0];
		const collapsed = skillDetail({ theme: fakeTheme, width: 80, row, budget: 4, expanded: false, dirty: false }).join(
			"\n",
		);
		const expanded = skillDetail({ theme: fakeTheme, width: 80, row, budget: 4, expanded: true, dirty: false }).join(
			"\n",
		);

		expect(collapsed).not.toContain("SECOND");
		expect(expanded).toContain("SECOND");
	});

	test("names why Pi refused the file", () => {
		const model = buildSkillModel({
			items: [skillItem("broken")],
			index: skillIndex({
				"/agent/skills/broken/SKILL.md": {
					description: "",
					modelHidden: false,
					problem: "missing description",
				},
			}),
			agentDir: "/agent",
		});
		const detail = skillDetail({
			theme: fakeTheme,
			width: 80,
			row: model.rows[0],
			budget: 3,
			expanded: false,
			dirty: false,
		});

		expect(detail.join("\n")).toContain("Not loaded: missing description");
	});

	test("keeps the saved marker while dirty", () => {
		const detail = skillDetail({
			theme: fakeTheme,
			width: 80,
			row: skillsModel().rows[0],
			budget: 3,
			expanded: false,
			dirty: true,
		}).join("\n");

		expect(detail).toContain("Saved · reload to apply");
	});

	test("drops the description when the pane has no room", () => {
		const detail = skillDetail({
			theme: fakeTheme,
			width: 80,
			row: skillsModel().rows[0],
			budget: 0,
			expanded: false,
			dirty: false,
		}).join("\n");

		expect(detail).toContain("/agent/skills/pdf/SKILL.md");
		expect(detail).not.toContain("Extract text");
	});

	test("hints the expansion and the project override, never a probe", () => {
		const texts = (hints: ReturnType<typeof sectionHints>): string[] =>
			hints.map((hint) => (typeof hint === "string" ? hint : hint.text));

		const collapsed = texts(sectionHints({ expanded: false, projectScope: false }));
		const expanded = texts(sectionHints({ expanded: true, projectScope: true }));

		expect(collapsed).toContain("Enter detail");
		expect(collapsed).not.toContain("x inherit");
		expect(collapsed).not.toContain("r refresh");
		expect(expanded).toContain("Enter collapse");
		expect(expanded).toContain("x inherit");
	});
});

describe("settings view", () => {
	test("states the scope and the settings count", () => {
		expect(settingsSummary(fakeTheme, 80, "global", 14)).toContain("Global");
		expect(settingsSummary(fakeTheme, 80, "global", 14)).toContain("14 settings");
		expect(settingsSummary(fakeTheme, 80, "project", 12)).toContain("Project");
	});

	test("notes that app settings are Global only", () => {
		const line = projectNote(coloringTheme, 80);
		expect(line).toContain("[dim]App settings are Global only.");
		expect(visibleWidth(line)).toBeLessThanOrEqual(80);
	});

	test("draws a checkbox for a boolean row and a plain value for an enum", () => {
		const off = settingView(settingsSnapshot(), "global", "notify.enabled");
		const on = settingView(settingsSnapshot({ global: { notify: { enabled: true } } }), "global", "notify.enabled");
		const theme = settingView(settingsSnapshot(), "global", "theme");

		expect(settingRow(fakeTheme, 80, off, false)).toContain(GLYPHS.boxOff);
		expect(settingRow(fakeTheme, 80, on, false)).toContain(GLYPHS.boxOn);
		expect(settingRow(fakeTheme, 80, theme, false)).not.toContain(GLYPHS.boxOff);
		expect(settingRow(fakeTheme, 80, theme, false)).toContain("system");
	});

	test("accents the focused setting and puts its value beside the label", () => {
		const line = settingRow(coloringTheme, 120, settingView(settingsSnapshot(), "global", "notify.turnFinished"), true);

		expect(line).toContain("[accent]Turn finished");
		expect(line).toContain("On");
		expect(visibleWidth(line)).toBeLessThanOrEqual(120);
	});

	test("keeps the label and the caret while editing a long value at a narrow width", () => {
		const line = settingRow(
			fakeTheme,
			30,
			settingView(settingsSnapshot({ global: { price: { budget: 0 } } }), "global", "price.budget"),
			true,
			{
				buffer: "1234567890",
				caret: 10,
			},
		);

		expect(line).toContain("Session");
		expect(line).toContain("▏");
		expect(line).toContain("…");
		expect(visibleWidth(line)).toBeLessThanOrEqual(30);
	});

	test("names the source, description, and origin of the focused setting", () => {
		const detail = settingDetail({
			theme: fakeTheme,
			width: 80,
			view: settingView(settingsSnapshot({ app: { quietStartup: true } as Settings }), "global", "byteflyUi"),
			budget: 3,
			dirty: false,
			paths: { scope: "global", cwd: "/proj", agentDir: "/agent" },
		});
		const text = detail.join("\n");

		expect(text).toContain("Bytefly startup TUI — Pi setting");
		expect(text).toContain("Use bytefly's startup header");
		expect(text).toContain(`Global · ${join("/agent", "settings.json")}`);
	});

	test("names an inherited project value and a project override with their file", () => {
		const inherited = settingDetail({
			theme: fakeTheme,
			width: 80,
			view: settingView(settingsSnapshot({ global: { job: { wakeOnFinish: true } } }), "project", "job.wakeOnFinish"),
			budget: 3,
			dirty: false,
			paths: { scope: "project", cwd: "/proj", agentDir: "/agent" },
		}).join("\n");
		expect(inherited).toContain(`Inherited from Global · ${join("/agent", "bytefly.json")}`);

		const overridden = settingDetail({
			theme: fakeTheme,
			width: 80,
			view: settingView(settingsSnapshot({ project: { job: { wakeOnFinish: true } } }), "project", "job.wakeOnFinish"),
			budget: 3,
			dirty: false,
			paths: { scope: "project", cwd: "/proj", agentDir: "/agent" },
		}).join("\n");
		expect(overridden).toContain(`Project · ${join("/proj", ".pi", "bytefly.json")}`);
	});

	test("keeps the saved marker when the detail body collapses", () => {
		const detail = settingDetail({
			theme: fakeTheme,
			width: 80,
			view: settingView(settingsSnapshot(), "global", "byteflyUi"),
			budget: 0,
			dirty: true,
			paths: { scope: "global", cwd: "/proj", agentDir: "/agent" },
		});

		expect(detail).toHaveLength(1);
		expect(detail[0]).toContain("Saved · reload to apply");
	});

	test("shows the focused row's section as stored, with its scope file", () => {
		const detail = sectionJsonPane({
			theme: fakeTheme,
			width: 80,
			section: "job",
			document: { wakeOnFinish: true },
			budget: 4,
			dirty: false,
			paths: { scope: "global", cwd: "/proj", agentDir: "/agent" },
		});
		const text = detail.join("\n");

		expect(text).toContain("job");
		expect(text).toContain(`Global · ${join("/agent", "bytefly.json")}`);
		expect(text).toContain('"wakeOnFinish": true');
	});

	test("says when the focused section is not set in this scope", () => {
		const detail = sectionJsonPane({
			theme: fakeTheme,
			width: 80,
			section: "job",
			document: undefined,
			budget: 3,
			dirty: false,
			paths: { scope: "project", cwd: "/proj", agentDir: "/agent" },
		});

		expect(detail.join("\n")).toContain("Not set in this scope.");
	});

	test("counts the JSON lines it hides and keeps the saved marker", () => {
		const doctor = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`key${index}`, `value ${index}`]));
		const detail = sectionJsonPane({
			theme: fakeTheme,
			width: 80,
			section: "doctor",
			document: doctor,
			budget: 3,
			dirty: true,
			paths: { scope: "global", cwd: "/proj", agentDir: "/agent" },
		});
		const text = detail.join("\n");

		expect(text).toContain("more lines");
		expect(text).toContain("Saved · reload to apply");
	});

	test("names the JSON toggle and the editor keys", () => {
		expect(settingsHints().join(" ")).toContain("J JSON");
		expect(settingsHints(true).join(" ")).toContain("J hide");
		expect(editHints().join(" ")).toContain("Esc cancel");
		expect(editHints().join(" ")).toContain("Enter save");
	});
});
