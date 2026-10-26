/**
 * The bytefly panel's merged row model and its text projection: the
 * extension/skill join with its health rule, and the listings, headlines, and
 * counts `/bytefly` prints outside the TUI.
 */

import { describe, expect, test } from "bun:test";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import {
	enabledItem,
	findRow,
	pathRow,
	settingView,
	settingsSnapshot,
	skillIndex,
	textModel,
	userRow,
} from "../../../test/helpers/fixtures/bytefly.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { makeItem, skillItem } from "../../../test/helpers/fixtures/picker.ts";
import {
	formatHeadline,
	formatListing,
	formatRow,
	formatSettingsHeadline,
	formatSettingsListing,
	panelCounts,
	sectionSegments,
	settingsSummarySegments,
	SKILL_NOUN,
	summarySegments,
} from "./format.ts";
import { buildPanelModel, buildSkillModel, extensionName, REPORT_ONLY_LABEL } from "./join.ts";
import { resourceKey } from "../picker/resources.ts";
import { settingViews } from "./settings.ts";

describe("panel model", () => {
	test("takes the extension directory, not the display name", () => {
		expect(extensionName("/pkg/extensions/web-access/index.ts")).toBe("web-access");
		expect(extensionName("/agent/extensions/a.ts")).toBe("extensions");
	});

	test("joins a subfolder item to its report on the directory name", () => {
		const report = makeReport("web-access", [makeFinding("unpdf", "degraded")]);
		const model = buildPanelModel({ items: [enabledItem("web-access")], reports: [report], agentDir: "/agent" });

		expect(model.rows).toHaveLength(1);
		expect(model.rows[0]?.label).toBe("web-access/index.ts");
		expect(model.rows[0]?.report).toBe(report);
	});

	test("keys a flat item by its resource identity and matches no report", () => {
		const item = pathRow("/agent/extensions/a.ts");
		const model = buildPanelModel({ items: [item], reports: [makeReport("plan")], agentDir: "/agent" });

		expect(model.rows[0]?.key).toBe("auto:/agent/extensions/a.ts");
		expect(model.rows[0]?.report).toBeUndefined();
	});

	test("appends a report with no item in one trailing group", () => {
		const model = buildPanelModel({
			items: [enabledItem("todo")],
			reports: [makeReport("todo"), makeReport("bytefly")],
			agentDir: "/agent",
		});

		expect(model.groups.at(-1)?.label).toBe(REPORT_ONLY_LABEL);
		const last = model.rows.at(-1);
		expect(last?.key).toBe("report:bytefly");
		expect(last?.item).toBeUndefined();
		expect(last?.report?.extension).toBe("bytefly");
	});

	test("gives no report to every resource that shares a directory name", () => {
		const planReport = makeReport("plan", [makeFinding("git", "missing", "no git", "install git")]);
		const model = buildPanelModel({
			items: [enabledItem("plan"), userRow("plan"), enabledItem("todo")],
			reports: [planReport, makeReport("todo")],
			agentDir: "/agent",
		});

		const planRows = model.rows.filter((row) => row.item && extensionName(row.item.path) === "plan");
		expect(planRows).toHaveLength(2);
		expect(planRows.every((row) => row.report === undefined)).toBe(true);

		const todo = model.rows.find((row) => row.item && extensionName(row.item.path) === "todo");
		expect(todo?.report?.extension).toBe("todo");

		// The unclaimed report surfaces under `Not resolved` with its findings intact.
		expect(model.groups.at(-1)?.label).toBe(REPORT_ONLY_LABEL);
		const other = model.rows.find((row) => !row.item);
		expect(other?.key).toBe("report:plan");
		expect(other?.report?.findings).toEqual(planReport.findings);
	});

	test("keeps distinct keys for flat items sharing a directory and gives them no health", () => {
		const first = pathRow("/agent/extensions/a.ts");
		const second = makeItem({
			path: "/pkg/extensions/b.ts",
			metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg/extensions" },
		});
		const model = buildPanelModel({
			items: [first, second],
			reports: [makeReport("extensions", [makeFinding("x", "missing")])],
			agentDir: "/agent",
		});

		const itemRows = model.rows.filter((row) => row.item);
		expect(itemRows).toHaveLength(2);
		expect(new Set(itemRows.map((row) => row.key)).size).toBe(2);
		expect(itemRows.every((row) => row.report === undefined)).toBe(true);
		expect(model.rows.some((row) => !row.item && row.report?.extension === "extensions")).toBe(true);
	});

	test("preserves the picker's groups and order", () => {
		const model = buildPanelModel({
			items: [pathRow("/agent/extensions/a.ts"), enabledItem("plan")],
			reports: [],
			agentDir: "/agent",
		});

		expect(model.groups).toHaveLength(2);
		expect(model.groups[0]?.label).toContain("npm:pkg");
		expect(model.rows[0]?.label).toBe("plan/index.ts");
		expect(model.rows[1]?.label).toBe("a.ts");
	});

	test("narrows to one extension directory and drops empty groups", () => {
		const model = buildPanelModel({
			items: [enabledItem("plan"), enabledItem("todo")],
			reports: [makeReport("plan"), makeReport("todo")],
			agentDir: "/agent",
			filter: "todo",
		});

		expect(model.rows).toHaveLength(1);
		expect(model.rows[0]?.label).toBe("todo/index.ts");
		expect(model.groups.every((group) => group.count > 0)).toBe(true);
	});

	test("retains the focused row identity when a shared directory name is rebuilt", () => {
		const packagePlan = enabledItem("plan");
		const userPlan = userRow("plan", "extra.ts");
		const before = buildPanelModel({ items: [packagePlan, userPlan], reports: [], agentDir: "/agent" });
		const planRows = before.rows.filter((row) => row.item && extensionName(row.item.path) === "plan");
		const focusedKey = planRows[1]?.key;
		expect(focusedKey).toBe(resourceKey(userPlan));

		const after = buildPanelModel({
			items: [enabledItem("alpha"), userPlan, packagePlan],
			reports: [],
			agentDir: "/agent",
		});
		expect(after.rows.find((row) => row.key === focusedKey)?.item?.path).toBe(userPlan.path);
	});
});

describe("panel text projection", () => {
	test("counts rows, off extensions, and problem findings", () => {
		expect(panelCounts(textModel())).toEqual({ rows: 3, off: 1, missing: 1, degraded: 0 });
	});

	test("counts a report once when the model carries it on more than one row", () => {
		const report = makeReport("plan", [makeFinding("git", "missing"), makeFinding("jq", "degraded")]);
		const single = buildPanelModel({ items: [enabledItem("plan")], reports: [report], agentDir: "/agent" });
		const row = single.rows[0];
		if (!row) throw new Error("expected a row");
		const duplicated = { ...single, rows: [...single.rows, { ...row, key: "duplicate" }] };

		expect(panelCounts(duplicated)).toEqual({ rows: 2, off: 0, missing: 1, degraded: 1 });
	});

	test("does not count the findings of an off row as problems", () => {
		const off = buildPanelModel({
			items: [enabledItem("plan", false)],
			reports: [makeReport("plan", [makeFinding("git", "missing")])],
			agentDir: "/agent",
		});

		expect(panelCounts(off)).toEqual({ rows: 1, off: 1, missing: 0, degraded: 0 });
	});

	test("states the scope, counts, and problems", () => {
		expect(formatHeadline(textModel(), "global")).toBe("bytefly: Global · 3 extensions · 1 off · 1 missing");
		expect(formatHeadline(textModel(), "global", { compact: true })).toBe(
			"bytefly: Global · 3 ext · 1 off · 1 missing",
		);
		expect(formatHeadline(textModel(), "project")).toContain("Project");
	});

	test("names a narrowed extension through the summary segments", () => {
		const narrowed = buildPanelModel({
			items: [enabledItem("plan")],
			reports: [makeReport("plan", [makeFinding("git", "degraded")])],
			agentDir: "/agent",
			filter: "plan",
		});
		expect(
			summarySegments(narrowed, "global", { filter: "plan" })
				.map((segment) => segment.text)
				.join(" · "),
		).toBe("Global · plan only · 1 degraded");
		expect(formatHeadline(narrowed, "global")).toBe("bytefly: Global · 1 extension · 1 degraded");
	});

	test("colors the headline by meaning: scope accent, counts meta, problems bad or warn", () => {
		expect(summarySegments(textModel(), "global").map((segment) => segment.color)).toEqual([
			"accent",
			"meta",
			"meta",
			"bad",
		]);
		const degradedOnly = buildPanelModel({
			items: [enabledItem("plan")],
			reports: [makeReport("plan", [makeFinding("unpdf", "degraded")])],
			agentDir: "/agent",
		});
		expect(summarySegments(degradedOnly, "global").at(-1)?.color).toBe("warn");
	});

	test("orders the three section names and accents the active one", () => {
		expect(sectionSegments("extensions")).toEqual([
			{ text: "Extensions", color: "accent" },
			{ text: "Skills", color: "faint" },
			{ text: "Settings", color: "faint" },
		]);
		expect(sectionSegments("skills")).toEqual([
			{ text: "Extensions", color: "faint" },
			{ text: "Skills", color: "accent" },
			{ text: "Settings", color: "faint" },
		]);
		expect(sectionSegments("settings")).toEqual([
			{ text: "Extensions", color: "faint" },
			{ text: "Skills", color: "faint" },
			{ text: "Settings", color: "accent" },
		]);
		expect(settingsSummarySegments("global", 11).map((segment) => segment.text)).toEqual(["Global", "11 settings"]);
		expect(settingsSummarySegments("project", 8).map((segment) => segment.text)).toEqual(["Project", "8 settings"]);
		expect(formatSettingsHeadline(28)).toBe("bytefly: Settings · Global · 28 settings");
	});

	test("renders a row without a report with no glyph and no summary", () => {
		const row = findRow(textModel([enabledItem("memory")]), "memory/index.ts");

		expect(formatRow(row)).toContain("[x] memory/index.ts");
		expect(formatRow(row)).not.toContain(GLYPHS.check);
		expect(formatRow(row)).not.toContain("ok");
	});

	test("suffixes a reported row with its health", () => {
		const row = findRow(textModel(), "plan/index.ts");
		expect(formatRow(row)).toContain(`${GLYPHS.cross} plan/index.ts — 1 missing`);
	});

	test("reads an off row as off, not as its health", () => {
		const off = buildPanelModel({
			items: [enabledItem("plan", false)],
			reports: [makeReport("plan", [makeFinding("git", "missing")])],
			agentDir: "/agent",
		}).rows[0];
		if (!off) throw new Error("expected a row");

		expect(formatRow(off)).toContain(`${GLYPHS.disabled} plan/index.ts — off`);
		expect(formatRow(off)).not.toContain("missing");
		expect(formatRow(off)).not.toContain("ok");
	});

	test("names the environment's disable list separately from settings", () => {
		const envOff = buildPanelModel({
			items: [enabledItem("plan")],
			reports: [makeReport("plan", [makeFinding("state", "info", "disabled through PI_DISABLED_EXTENSIONS")], false)],
			agentDir: "/agent",
		}).rows[0];
		if (!envOff) throw new Error("expected a row");

		expect(formatRow(envOff)).toContain(`${GLYPHS.disabled} plan/index.ts — env disabled`);
	});

	test("renders a report with no item without a checkbox", () => {
		const reported = buildPanelModel({
			items: [],
			reports: [makeReport("bytefly", [makeFinding("platform", "info", "TUI only")])],
			agentDir: "/agent",
		}).rows[0];
		if (!reported) throw new Error("expected a row");

		expect(formatRow(reported)).toContain("bytefly — ok");
		expect(formatRow(reported)).not.toContain("[");
		expect(formatRow(reported)).not.toContain(GLYPHS.check);
	});

	test("lists groups with a heading and a health suffix per row", () => {
		const text = formatListing(textModel(), "global");
		expect(text.split("\n")[0]).toBe("bytefly: Global · 3 extensions · 1 off · 1 missing");
		expect(text).toContain("npm:pkg (user) (3)");
		expect(text).toContain(`[x] ${GLYPHS.cross} plan/index.ts — 1 missing`);
		expect(text).toContain(`[ ] ${GLYPHS.disabled} memory/index.ts — off`);
	});

	test("lists skills with the skills noun and one verdict per row", () => {
		const model = buildSkillModel({
			items: [skillItem("pdf"), skillItem("quiet"), skillItem("broken")],
			index: skillIndex({
				"/agent/skills/pdf/SKILL.md": {
					name: "pdf-tools",
					description: "Read PDFs.",
					modelHidden: false,
				},
				"/agent/skills/quiet/SKILL.md": {
					name: "quiet",
					description: "By name only.",
					modelHidden: true,
				},
				"/agent/skills/broken/SKILL.md": {
					description: "",
					modelHidden: false,
					problem: "missing description",
				},
			}),
			agentDir: "/agent",
		});

		const text = formatListing(model, "global", { noun: SKILL_NOUN });
		expect(text.split("\n")[0]).toBe("bytefly: Global · 3 skills");
		expect(text).toContain("[x] pdf-tools");
		expect(text).toContain("quiet — hidden");
		expect(text).toContain(`${GLYPHS.warn} broken — not loaded`);
		expect(formatHeadline(model, "global", { noun: SKILL_NOUN })).toBe("bytefly: Global · 3 skills");
		expect(panelCounts(model)).toEqual({ rows: 3, off: 0, missing: 0, degraded: 0 });
	});

	test("reports an empty skill list with its own empty label", () => {
		const empty = buildSkillModel({ items: [], index: new Map(), agentDir: "/agent" });
		expect(formatListing(empty, "global", { noun: SKILL_NOUN, emptyLabel: "No skills found." })).toContain(
			"No skills found.",
		);
	});

	test("reports an empty result", () => {
		const empty = buildPanelModel({ items: [], reports: [], agentDir: "/agent" });
		expect(formatListing(empty, "global")).toContain("No extensions found.");
	});

	test("lists settings flat, in screen order, with their values", () => {
		const views = settingViews(settingsSnapshot(), "global");
		const lines = formatSettingsListing(views).split("\n");

		expect(lines[0]).toBe("bytefly: Settings · Global · 12 settings");
		expect(lines[1]).toContain("Bytefly startup TUI: Off");
		expect(lines).toHaveLength(13);
		expect(lines.join("\n")).not.toContain("Notifications (");
		for (const row of [
			"Bytefly startup TUI: Off",
			"Theme: system",
			"Desktop notifications: Off",
			"Turn finished: On",
			"Needs input: On",
			"Job finished: On",
			"Watcher matched: On",
			"Wake when a job finishes: Off",
			"Automatic snapshots: On",
			"Proactive health check: On",
			"Currency: CNY (¥)",
			"Session budget: 0",
		]) {
			expect(lines.join("\n"), row).toContain(row);
		}
	});

	test("sanitizes a settings label and value before printing it", () => {
		const view = {
			...settingView(settingsSnapshot(), "global", "byteflyUi"),
			label: "Bad\u001b[31m",
			valueLabel: "On\u0007",
		};
		const text = formatSettingsListing([view]);

		expect(text).not.toContain("\u001b");
		expect(text).not.toContain("\u0007");
	});
});
