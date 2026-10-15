import { describe, expect, test } from "bun:test";
import { GLYPHS } from "../../../lib/ui.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { makeItem } from "../../../test/helpers/fixtures/picker.ts";
import { formatHeadline, formatListing, formatRow, panelCounts } from "./format.ts";
import { buildPanelModel } from "./join.ts";

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

	test("names a narrowed extension instead of counting", () => {
		const narrowed = buildPanelModel({
			items: [packageItem("plan")],
			reports: [makeReport("plan", [makeFinding("git", "degraded")])],
			agentDir: "/agent",
			filter: "plan",
		});
		expect(formatHeadline(narrowed, "global", { filter: "plan" })).toBe("bytefly: Global · plan only · 1 degraded");
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
