import { describe, expect, test } from "bun:test";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { makeItem } from "../../../test/helpers/fixtures/picker.ts";
import {
	formatHeadline,
	formatListing,
	formatRow,
	formatSettingsHeadline,
	formatSettingsListing,
	panelCounts,
	sectionSegments,
	settingsSummarySegments,
	summarySegments,
} from "./format.ts";
import { buildPanelModel } from "./join.ts";
import { settingViews } from "./settings.ts";

const packageItem = (name: string, enabled = true) =>
	makeItem({
		path: `/pkg/extensions/${name}/index.ts`,
		enabled,
		metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg/extensions" },
	});

function model(items = [packageItem("plan"), packageItem("todo"), packageItem("memory", false)]) {
	return buildPanelModel({
		items,
		reports: [makeReport("plan", [makeFinding("git", "missing", "not found on PATH", "install git")])],
		agentDir: "/agent",
	});
}

describe("panelCounts", () => {
	test("counts rows, disabled extensions, and problem findings", () => {
		expect(panelCounts(model())).toEqual({ extensions: 3, disabled: 1, missing: 1, degraded: 0 });
	});

	test("counts a report once when the model carries it on more than one row", () => {
		const report = makeReport("plan", [makeFinding("git", "missing"), makeFinding("jq", "degraded")]);
		const single = buildPanelModel({ items: [packageItem("plan")], reports: [report], agentDir: "/agent" });
		const row = single.rows[0];
		if (!row) throw new Error("expected a row");
		const duplicated = { ...single, rows: [...single.rows, { ...row, key: "duplicate" }] };

		expect(panelCounts(duplicated)).toEqual({ extensions: 2, disabled: 0, missing: 1, degraded: 1 });
	});
});

describe("headline", () => {
	test("states the scope, counts, and problems", () => {
		expect(formatHeadline(model(), "global")).toBe("bytefly: Global · 3 extensions · 1 disabled · 1 missing");
	});

	test("abbreviates on a narrow terminal", () => {
		expect(formatHeadline(model(), "global", { compact: true })).toBe("bytefly: Global · 3 ext · 1 off · 1 missing");
	});

	test("names a narrowed extension through the summary segments", () => {
		const narrowed = buildPanelModel({
			items: [packageItem("plan")],
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

	test("uses the project scope label", () => {
		expect(formatHeadline(model(), "project")).toContain("Project");
	});
});

describe("formatRow", () => {
	test("renders an item without a report with no glyph and no summary", () => {
		const row = buildPanelModel({ items: [packageItem("memory")], reports: [], agentDir: "/agent" }).rows[0];
		if (!row) throw new Error("expected a row");
		expect(formatRow(row)).toBe("  [x] memory/index.ts");
		expect(formatRow(row)).not.toContain(GLYPHS.check);
		expect(formatRow(row)).not.toContain("ok");
	});

	test("suffixes a reported row with its health", () => {
		const row = model().rows.find((candidate) => candidate.label === "plan/index.ts");
		if (!row) throw new Error("expected a row");
		expect(formatRow(row)).toBe(`  [x] ${GLYPHS.cross} plan/index.ts — 1 missing`);
	});

	test("renders a report with no item without a checkbox", () => {
		const reported = buildPanelModel({
			items: [],
			reports: [makeReport("bytefly", [makeFinding("platform", "info", "TUI only")])],
			agentDir: "/agent",
		}).rows[0];
		if (!reported) throw new Error("expected a row");
		expect(formatRow(reported)).toBe(`  ${GLYPHS.check} bytefly — ok`);
	});
});

describe("formatListing", () => {
	test("lists groups with heading and a health suffix per row", () => {
		const text = formatListing(model(), "global");
		expect(text.split("\n")[0]).toBe("bytefly: Global · 3 extensions · 1 disabled · 1 missing");
		expect(text).toContain("npm:pkg (user) (3)");
		expect(text).toContain(`[x] ${GLYPHS.cross} plan/index.ts — 1 missing`);
		expect(text).toContain("[ ] memory/index.ts");
	});

	test("reports an empty result", () => {
		const empty = buildPanelModel({ items: [], reports: [], agentDir: "/agent" });
		expect(formatListing(empty, "global")).toContain("No extensions found.");
	});
});

describe("sections", () => {
	test("orders the two section names and accents the active one", () => {
		expect(sectionSegments("extensions")).toEqual([
			{ text: "Extensions", color: "accent" },
			{ text: "Settings", color: "faint" },
		]);
		expect(sectionSegments("settings")).toEqual([
			{ text: "Extensions", color: "faint" },
			{ text: "Settings", color: "accent" },
		]);
	});

	test("states the scope and the settings count", () => {
		expect(settingsSummarySegments("global", 5).map((segment) => segment.text)).toEqual(["Global", "5 settings"]);
		expect(settingsSummarySegments("project", 2).map((segment) => segment.text)).toEqual(["Project", "2 settings"]);
		expect(settingsSummarySegments("global", 1).map((segment) => segment.text)).toEqual(["Global", "1 setting"]);
	});

	test("prints one settings headline for non-TUI modes", () => {
		expect(formatSettingsHeadline("global", 5)).toBe("bytefly: Settings · Global · 5 settings");
		expect(formatSettingsHeadline("project", 2)).toBe("bytefly: Settings · Project · 2 settings");
	});

	test("lists settings in groups with their values", () => {
		const views = settingViews({ app: {}, global: {}, project: {} }, "global");
		const text = formatSettingsListing(views, "global");

		expect(text.split("\n")[0]).toBe("bytefly: Settings · Global · 5 settings");
		expect(text).toContain("Startup (1)");
		expect(text).toContain("Notifications (1)");
		expect(text).toContain("Transcript (2)");
		expect(text).toContain("Terminal (1)");
		expect(text).toContain("Quiet startup: Full");
		expect(text).toContain("Desktop notifications: Off");
	});

	test("names the missing app rows in the project listing", () => {
		const views = settingViews({ app: {}, global: {}, project: {} }, "project");
		const text = formatSettingsListing(views, "project");

		expect(text).toContain("Project · 2 settings");
		expect(text).toContain("App settings are Global only.");
		expect(text).not.toContain("Quiet startup");
	});
});
