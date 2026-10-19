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
	test("counts rows, off extensions, and problem findings", () => {
		expect(panelCounts(model())).toEqual({ extensions: 3, off: 1, missing: 1, degraded: 0 });
	});

	test("counts a report once when the model carries it on more than one row", () => {
		const report = makeReport("plan", [makeFinding("git", "missing"), makeFinding("jq", "degraded")]);
		const single = buildPanelModel({ items: [packageItem("plan")], reports: [report], agentDir: "/agent" });
		const row = single.rows[0];
		if (!row) throw new Error("expected a row");
		const duplicated = { ...single, rows: [...single.rows, { ...row, key: "duplicate" }] };

		expect(panelCounts(duplicated)).toEqual({ extensions: 2, off: 0, missing: 1, degraded: 1 });
	});

	test("does not count the findings of an off row as problems", () => {
		const off = buildPanelModel({
			items: [packageItem("plan", false)],
			reports: [makeReport("plan", [makeFinding("git", "missing")])],
			agentDir: "/agent",
		});

		expect(panelCounts(off)).toEqual({ extensions: 1, off: 1, missing: 0, degraded: 0 });
	});
});

describe("headline", () => {
	test("states the scope, counts, and problems", () => {
		expect(formatHeadline(model(), "global")).toBe("bytefly: Global · 3 extensions · 1 off · 1 missing");
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

	test("reads an off row as off, not as its health", () => {
		const off = buildPanelModel({
			items: [packageItem("plan", false)],
			reports: [makeReport("plan", [makeFinding("git", "missing")])],
			agentDir: "/agent",
		}).rows[0];
		if (!off) throw new Error("expected a row");

		expect(formatRow(off)).toBe(`  [ ] ${GLYPHS.disabled} plan/index.ts — off`);
		expect(formatRow(off)).not.toContain("missing");
		expect(formatRow(off)).not.toContain("ok");
	});

	test("names the environment's disable list separately from settings", () => {
		const envOff = buildPanelModel({
			items: [packageItem("plan")],
			reports: [makeReport("plan", [makeFinding("state", "info", "disabled through PI_DISABLED_EXTENSIONS")], false)],
			agentDir: "/agent",
		}).rows[0];
		if (!envOff) throw new Error("expected a row");

		expect(formatRow(envOff)).toBe(`  [x] ${GLYPHS.disabled} plan/index.ts — env disabled`);
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
		expect(text.split("\n")[0]).toBe("bytefly: Global · 3 extensions · 1 off · 1 missing");
		expect(text).toContain("npm:pkg (user) (3)");
		expect(text).toContain(`[x] ${GLYPHS.cross} plan/index.ts — 1 missing`);
		expect(text).toContain(`[ ] ${GLYPHS.disabled} memory/index.ts — off`);
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
		expect(settingsSummarySegments("global", 11).map((segment) => segment.text)).toEqual(["Global", "11 settings"]);
		expect(settingsSummarySegments("project", 8).map((segment) => segment.text)).toEqual(["Project", "8 settings"]);
	});

	test("prints one settings headline for non-TUI modes", () => {
		expect(formatSettingsHeadline(28)).toBe("bytefly: Settings · Global · 28 settings");
	});

	test("lists settings in groups with their values", () => {
		const views = settingViews({ app: {}, global: {}, project: {}, themes: [] }, "global");
		const text = formatSettingsListing(views);

		expect(text.split("\n")[0]).toBe("bytefly: Settings · Global · 29 settings");
		expect(text).toContain("Startup (1)");
		expect(text).toContain("Notifications (7)");
		expect(text).toContain("Diagnostics (2)");
		expect(text).toContain("Pricing (3)");
		expect(text).toContain("Transcript (3)");
		expect(text).toContain("Terminal (2)");
		expect(text).toContain("Worktree (4)");
		expect(text).toContain("Snapshots (3)");
		expect(text).toContain("Jobs and watchers (3)");
		expect(text).toContain("Memory (1)");
		expect(text).toContain("Bytefly startup TUI: Off");
		expect(text).toContain("Desktop notifications: Off");
		expect(text).toContain("Turn finished: On");
		expect(text).toContain("Needs input: On");
		expect(text).toContain("Job finished: On");
		expect(text).toContain("Delivery method: Auto");
		expect(text).toContain("Notification title: Pi");
		expect(text).toContain("Proactive health check: On");
		expect(text).toContain("Probe timeout: 2000");
		expect(text).toContain("Currency: CNY (¥)");
		expect(text).toContain("Cost decimals: 2");
		expect(text).toContain("Theme: system");
	});
});
