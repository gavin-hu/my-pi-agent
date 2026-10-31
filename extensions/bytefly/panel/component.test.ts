/**
 * `PanelComponent`'s frames: the docked screen, its headline and hint rows, and
 * the Extensions and Skills lists.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { coloringTheme } from "../../../test/helpers/fakes.ts";
import { SKILLS_INDEX, buildPanel, enabledItem, selectedLine } from "../../../test/helpers/fixtures/panel.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { makeItem, skillItem } from "../../../test/helpers/fixtures/picker.ts";
import { settle } from "../../../test/helpers/process.ts";

describe("PanelComponent rendering", () => {
	test("joins each item to its report and shows both", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			reports: [makeReport("plan", [makeFinding("git", "degraded")])],
		});

		const text = component.render(80).join("\n");
		expect(text).toContain("plan");
		expect(text).toContain("1 degraded");
	});

	test("draws the Bytefly header and a checkbox column", () => {
		const { component } = buildPanel({ items: [enabledItem("plan")], reports: [] });

		const lines = component.render(60);
		expect(lines[0]).toContain("Bytefly");
		expect(lines.join("\n")).toContain(GLYPHS.boxOn);
	});

	test("renders no glyph and no health for an item with no report", () => {
		const { component } = buildPanel({ items: [enabledItem("memory")], reports: [] });

		const text = component.render(80).join("\n");
		expect(text).toContain("memory/index.ts");
		expect(text).not.toContain(GLYPHS.check);
		expect(text).not.toContain("ok");
	});

	test("keeps every line inside the width at 44, 64, and 96", () => {
		const items = Array.from({ length: 12 }, (_, index) => enabledItem(`ext-${String(index).padStart(2, "0")}`));
		const reports = [
			makeReport("ext-00", [makeFinding("git", "missing", "a very long detail ".repeat(6), "and a longer hint")]),
			makeReport("ext-01", [makeFinding("unpdf", "degraded")]),
		];
		for (const width of [44, 64, 96]) {
			const { component } = buildPanel({ items, reports });
			for (const line of component.render(width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("keeps every line within the width in all sections at 80, 48, and 40", () => {
		for (const section of ["extensions", "skills", "settings"] as const) {
			const { component } = buildPanel({ items: [enabledItem("plan")], reports: [], section });
			for (const width of [80, 48, 40]) {
				for (const line of component.render(width)) {
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				}
			}
		}
	});

	test("fits the terminal height, collapsing the detail pane when rows run out", () => {
		const items = Array.from({ length: 12 }, (_, index) => enabledItem(`ext-${String(index).padStart(2, "0")}`));
		const reports = [makeReport("ext-00", [makeFinding("git", "missing", "missing git", "install git")])];
		for (const rows of [10, 14, 24, 40]) {
			const { component } = buildPanel({ items, reports, rows });
			expect(component.render(80).length).toBeLessThanOrEqual(rows);
		}
	});

	test("keeps the section counts on the tabs at every width", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan"), enabledItem("todo")],
			reports: [makeReport("plan")],
		});
		expect(component.render(96).join("\n")).toContain("Extensions 2");
		expect(component.render(44).join("\n")).toContain("Extensions 2");
		expect(component.render(96).join("\n")).toContain("writes Global");
		expect(component.render(44).join("\n").includes("Extensions 2")).toBe(true);
	});

	test("narrows the screen to one extension", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan"), enabledItem("todo")],
			reports: [makeReport("plan")],
			filter: "plan",
		});

		const text = component.render(80).join("\n");
		expect(text).toContain("plan only");
		expect(text).toContain("plan");
		expect(text).not.toContain("todo");
	});

	test("shows the focused row's findings and moves them with the selection", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan"), enabledItem("todo")],
			reports: [
				makeReport("plan", [makeFinding("git", "missing", "plan needs git", "install git")]),
				makeReport("todo", [makeFinding("todo.json", "missing", "todo is broken", "fix todo")]),
			],
		});

		expect(component.render(70).join("\n")).toContain("plan needs git");
		component.handleInput("j");
		expect(component.render(70).join("\n")).toContain("todo is broken");
	});

	test("shows notes only once Enter expands the detail", () => {
		const { component } = buildPanel({
			items: [enabledItem("bytefly")],
			reports: [makeReport("bytefly", [makeFinding("platform", "info", "TUI only")])],
		});

		expect(component.render(70).join("\n")).not.toContain("TUI only");
		component.handleInput("\r");
		expect(component.render(70).join("\n")).toContain("TUI only");
	});

	test("expands only the focused row and remembers it", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan"), enabledItem("todo")],
			reports: [
				makeReport("plan", [makeFinding("platform", "info", "plan note")]),
				makeReport("todo", [makeFinding("platform", "info", "todo note")]),
			],
		});

		component.handleInput("\r");
		expect(component.render(70).join("\n")).toContain("plan note");

		component.handleInput("j");
		expect(component.render(70).join("\n")).not.toContain("todo note");

		component.handleInput("k");
		expect(component.render(70).join("\n")).toContain("plan note");
	});

	test("flips the Enter hint with the focused row", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan"), enabledItem("todo")],
			reports: [makeReport("plan", [makeFinding("git", "missing")])],
		});

		expect(component.render(96).join("\n")).toContain("Enter detail");
		component.handleInput("\r");
		expect(component.render(96).join("\n")).toContain("Enter collapse");
		component.handleInput("j");
		expect(component.render(96).join("\n")).toContain("Enter detail");
	});

	test("keeps the frame inside the terminal when an expanded list is clipped", () => {
		const items = Array.from({ length: 40 }, (_, index) => enabledItem(`ext-${String(index).padStart(2, "0")}`));
		const notes = Array.from({ length: 8 }, (_, index) => makeFinding(`note-${index}`, "info", `note ${index}`));
		const { component } = buildPanel({ items, reports: [makeReport("ext-00", notes)], rows: 40 });

		component.handleInput("\r");
		const lines = component.render(80);
		expect(lines.length).toBeLessThanOrEqual(40);
		expect(lines.join("\n")).toContain("showing");
	});

	test("grows the detail pane to the free height when expanded", () => {
		const notes = Array.from({ length: 8 }, (_, index) => makeFinding(`note-${index}`, "info", `note ${index}`));
		const { component } = buildPanel({
			items: [enabledItem("bytefly")],
			reports: [makeReport("bytefly", notes)],
			rows: 40,
		});

		expect(component.render(80).join("\n")).not.toContain("note 7");
		component.handleInput("\r");
		const text = component.render(80);
		expect(text.join("\n")).toContain("note 7");
		expect(text.length).toBeLessThanOrEqual(40);
	});

	test("reads a settings-off row as off while the detail still names its findings", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan", false)],
			reports: [makeReport("plan", [makeFinding("git", "missing", "missing git", "install git")])],
		});

		const lines = component.render(80);
		const row = lines.find((line) => line.includes("plan") && line.includes("off"));
		expect(row).toContain("off");
		expect(row).not.toContain("1 missing");
		expect(lines.join("\n")).toContain("git: missing git");
	});

	test("names the environment's disable list on the row", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			reports: [makeReport("plan", [makeFinding("state", "info", "disabled through env")], false)],
		});

		const row = component.render(80).find((line) => line.includes("plan"));
		expect(row).toContain("env disabled");
	});

	test("shows an unreported row's resource path in the detail pane", () => {
		const { component } = buildPanel({ items: [enabledItem("memory")], reports: [] });
		expect(component.render(80).join("\n")).toContain("/pkg/extensions/memory/index.ts");
	});

	test("sanitizes report text before it reaches the terminal", () => {
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			reports: [makeReport("plan", [makeFinding("git", "missing", "bad\u001b[31mtext")])],
		});
		expect(component.render(70).join("\n")).not.toContain("\u001b");
	});

	test("accents the focused row and dims a disabled row", () => {
		const { component } = buildPanel({
			items: [enabledItem("alpha"), enabledItem("zulu", false)],
			reports: [],
			theme: coloringTheme,
		});
		const text = component.render(60).join("\n");
		expect(text).toContain("[accent]alpha");
		expect(text).toContain("[dim]zulu");
	});

	test("reports an empty result", () => {
		const { component } = buildPanel({ items: [], reports: [] });
		expect(component.render(60).join("\n")).toContain("No extensions found.");
	});
});

describe("PanelComponent skills", () => {
	test("draws one vertical row per skill under its group heading", () => {
		const { component } = buildPanel({
			items: [],
			skills: [skillItem("pdf"), skillItem("quiet")],
			skillIndex: SKILLS_INDEX,
			section: "skills",
		});
		const lines = component.render(80);
		const rows = lines.filter((line) => line.includes("◼") || line.includes("◻"));
		const pdf = rows.filter((line) => line.includes("pdf"));
		const quiet = rows.filter((line) => line.includes("quiet"));

		expect(rows).toHaveLength(2);
		expect(pdf).toHaveLength(1);
		expect(quiet).toHaveLength(1);
		expect(pdf[0]).not.toBe(quiet[0]);
		expect(lines.join("\n")).toContain("Skills 2");
		expect(lines.join("\n")).toContain("User");
	});

	test("shows the description, the hidden verdict, and a refusal", () => {
		const { component } = buildPanel({
			items: [],
			skills: [skillItem("pdf")],
			skillIndex: SKILLS_INDEX,
			section: "skills",
		});
		const text = component.render(120).join("\n");
		expect(text).toContain("/agent/skills/pdf/SKILL.md");
		expect(text).toContain("Extract text and tables from PDF files.");

		const hidden = buildPanel({
			items: [],
			skills: [skillItem("quiet")],
			skillIndex: SKILLS_INDEX,
			section: "skills",
		}).component;
		expect(hidden.render(120).join("\n")).toContain("hidden");

		const broken = buildPanel({
			items: [],
			skills: [skillItem("broken")],
			skillIndex: SKILLS_INDEX,
			section: "skills",
		}).component;
		const refused = broken.render(120).join("\n");
		expect(refused).toContain("not loaded");
		expect(refused).toContain("missing description");
	});

	test("toggles the focused skill into the global skills array", async () => {
		const { component, store } = buildPanel({
			items: [],
			skills: [skillItem("pdf")],
			skillIndex: SKILLS_INDEX,
			section: "skills",
		});
		component.render(80);

		component.handleInput(" ");
		await settle();
		await settle();

		expect(store.calls.setSkillPaths.at(-1)).toEqual(["-skills/pdf/SKILL.md"]);
		expect(store.calls.setExtensionPaths).toEqual([]);
		expect(component.render(80).join("\n")).toContain("off");
	});

	test("writes a project override, then clears it with x", async () => {
		const { component, projectStore } = buildPanel({
			items: [],
			skills: [skillItem("pdf")],
			skillIndex: SKILLS_INDEX,
			section: "skills",
		});
		component.render(80);

		component.handleInput("s");
		component.handleInput(" ");
		await settle();
		await settle();
		expect(projectStore.calls.setProjectSkillPaths.at(-1)).toEqual([
			"/agent/skills/pdf/SKILL.md",
			"-/agent/skills/pdf/SKILL.md",
		]);

		component.handleInput("x");
		await settle();
		await settle();
		expect(projectStore.calls.setProjectSkillPaths.at(-1)).toEqual([]);
	});

	test("jumps groups and keeps the focus on a row identity", () => {
		const other = makeItem({
			path: "/other/skills/next/SKILL.md",
			metadata: { source: "auto", scope: "user", origin: "top-level", baseDir: "/other" },
		});
		const { component } = buildPanel({
			items: [],
			skills: [skillItem("pdf"), other],
			skillIndex: SKILLS_INDEX,
			section: "skills",
		});
		component.render(80);
		expect(selectedLine(component)).toContain("pdf");

		component.handleInput("]");
		expect(selectedLine(component)).toContain("next");
	});

	test("names skills in the untrusted-project refusal", () => {
		const { component } = buildPanel({
			items: [],
			skills: [skillItem("pdf")],
			skillIndex: SKILLS_INDEX,
			section: "skills",
			trusted: false,
		});

		component.handleInput("s");

		expect(component.render(80).join("\n")).toContain("manage skills in Global scope only");
	});

	test("reads the skill index once on first show and never probes", () => {
		let loads = 0;
		const refreshes: boolean[] = [];
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			skills: [skillItem("pdf")],
			skillIndex: () => {
				loads += 1;
				return SKILLS_INDEX();
			},
			section: "skills",
			needsProbe: true,
			refresh: (force) => {
				refreshes.push(force === true);
			},
		});

		component.prime();
		expect(loads).toBe(1);
		component.render(80);
		component.render(80);
		expect(loads).toBe(1);
		expect(refreshes).toEqual([]);
	});

	test("reports an empty skill list with its own label", () => {
		const { component } = buildPanel({ items: [], section: "skills" });
		expect(component.render(80).join("\n")).toContain("No skills found.");
	});
});
