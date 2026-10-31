/**
 * The two filters: what a query reaches, what "needs attention" means on a
 * resource row and on a setting, and the chips that say which is on.
 */

import { describe, expect, test } from "bun:test";
import { enabledItem, findRow, textModel } from "../../../test/helpers/fixtures/panel.ts";
import { settingView, settingsSnapshot } from "../../../test/helpers/fixtures/settings.ts";
import { filterChips, isFiltering, NO_FILTER, rowMatches, settingMatches, type PanelFilter } from "./filter.ts";

const filter = (overrides: Partial<PanelFilter> = {}): PanelFilter => ({ ...NO_FILTER, ...overrides });

describe("filtering resource rows", () => {
	const model = textModel();
	const plan = findRow(model, "plan");
	const memory = findRow(model, "memory");

	test("matches the name, the path, and the report", () => {
		expect(rowMatches(plan, filter({ query: "pl" }))).toBe(true);
		expect(rowMatches(plan, filter({ query: "PLAN" }))).toBe(true);
		expect(rowMatches(plan, filter({ query: "index.ts" }))).toBe(true);
		expect(rowMatches(plan, filter({ query: "npm" }))).toBe(true);
		expect(rowMatches(plan, filter({ query: "nothing-like-this" }))).toBe(false);
	});

	test("keeps only what needs attention, and an off row always does", () => {
		expect(rowMatches(plan, filter({ attentionOnly: true }))).toBe(true);
		expect(rowMatches(findRow(model, "todo"), filter({ attentionOnly: true }))).toBe(false);
		expect(rowMatches(memory, filter({ attentionOnly: true }))).toBe(true);
	});

	test("combines the two narrowings", () => {
		expect(rowMatches(plan, filter({ query: "plan", attentionOnly: true }))).toBe(true);
		expect(rowMatches(memory, filter({ query: "plan", attentionOnly: true }))).toBe(false);
	});

	test("reaches a skill's own description", () => {
		const row = {
			key: "auto:/agent/skills/pdf/SKILL.md",
			item: enabledItem("pdf"),
			label: "pdf",
			group: "auto",
			skill: { name: "pdf", description: "Extract text and tables from PDF files.", modelHidden: false },
		};

		expect(rowMatches(row, filter({ query: "tables" }))).toBe(true);
	});
});

describe("filtering settings rows", () => {
	const snapshot = settingsSnapshot({ app: { theme: "bytefly-dark" } });

	test("matches the label, the id, and the value", () => {
		const theme = settingView(snapshot, "global", "theme");

		expect(settingMatches(theme, filter({ query: "theme" }))).toBe(true);
		expect(settingMatches(theme, filter({ query: "bytefly-dark" }))).toBe(true);
		expect(settingMatches(theme, filter({ query: "zzz" }))).toBe(false);
	});

	test("keeps only the values changed from their default", () => {
		expect(settingMatches(settingView(snapshot, "global", "theme"), filter({ attentionOnly: true }))).toBe(true);
		expect(settingMatches(settingView(snapshot, "global", "notify.enabled"), filter({ attentionOnly: true }))).toBe(
			false,
		);
	});
});

describe("saying that a filter is on", () => {
	test("reports nothing narrowed for the empty filter", () => {
		expect(isFiltering(NO_FILTER)).toBe(false);
		expect(filterChips(NO_FILTER, "rows")).toEqual([]);
		expect(isFiltering(filter({ query: "  " }))).toBe(false);
	});

	test("names the query and the narrowing as separate chips", () => {
		const chips = filterChips(filter({ query: " workt ", attentionOnly: true }), "rows");

		expect(chips.map((chip) => chip.text)).toEqual(["/workt", "needs attention"]);
		expect(chips[1]?.color).toBe("warn");
	});

	test("calls the setting narrowing what it is", () => {
		expect(filterChips(filter({ attentionOnly: true }), "settings").map((chip) => chip.text)).toEqual(["changed only"]);
	});
});
