import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GLYPHS } from "../../lib/ui.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { makeFinding, makeReport } from "../../test/helpers/fixtures/doctor.ts";
import {
	countFindings,
	detailLines,
	extensionRow,
	formatExtension,
	formatHeadline,
	formatReport,
	formatWarning,
	hasProblems,
	reportSeverity,
	severityGlyph,
} from "./format.ts";

const ok = makeReport("todo", [makeFinding("todo.json", "ok")]);
const missing = makeReport("document", [
	makeFinding("pdfcraft-cli", "missing", "not found on PATH — PDF extraction", "cargo install --git ... pdfcraft-cli"),
]);

describe("counts and headline", () => {
	test("counts only missing and degraded as problems", () => {
		const reports = [ok, missing, makeReport("web-access", [makeFinding("unpdf", "degraded")])];
		expect(countFindings(reports)).toEqual({ extensions: 3, enabled: 3, missing: 1, degraded: 1 });
		expect(hasProblems(reports)).toBe(true);
		expect(formatHeadline(reports)).toBe("doctor: 1 missing, 1 degraded across 3 extensions");
	});

	test("says everything is ready when it is", () => {
		const reports = [ok, makeReport("goal")];
		expect(hasProblems(reports)).toBe(false);
		expect(formatHeadline(reports)).toBe("doctor: all 2 enabled extensions are ready");
	});

	test("counts a disabled extension out of the ready total", () => {
		const reports = [ok, makeReport("wechat", [makeFinding("state", "info")], false)];
		expect(countFindings(reports).enabled).toBe(1);
		expect(formatHeadline(reports)).toBe("doctor: all 1 enabled extensions are ready");
	});
});

describe("report text", () => {
	test("lists only the extensions with problems, with their hints", () => {
		const text = formatReport([ok, missing]);
		expect(text).toContain("pdfcraft-cli: not found on PATH");
		expect(text).toContain("→ cargo install");
		expect(text).not.toContain("todo");
	});

	test("lists notes when nothing is wrong", () => {
		const text = formatReport([makeReport("status-bar", [makeFinding("platform", "info", "TUI only")])]);
		expect(text).toContain("Notes:");
		expect(text).toContain("status-bar: TUI only");
	});

	test("shows every finding — including passing checks — for one extension", () => {
		const text = formatExtension(makeReport("document", [makeFinding("git", "ok"), ...missing.findings]));
		expect(text).toContain("document");
		expect(text).toContain("git: git detail");
		expect(text).toContain("pdfcraft-cli");
	});

	test("names the extension and the fix in the proactive warning", () => {
		expect(formatWarning(missing.findings)).toBe("doctor: missing document (pdfcraft-cli) — run /doctor");
	});

	test("sanitizes anything a probe produced", () => {
		const nasty = makeReport("document", [makeFinding("pdfcraft-cli", "missing", "failed\u001b[31m\u0007 to start")]);
		expect(formatReport([nasty])).not.toContain("\u001b");
		expect(formatReport([nasty])).not.toContain("\u0007");
	});
});

describe("rows and detail", () => {
	test("severity is the worst finding in the report", () => {
		expect(reportSeverity(ok)).toBe("ok");
		expect(reportSeverity(missing)).toBe("missing");
		expect(reportSeverity(makeReport("web-access", [makeFinding("unpdf", "degraded")]))).toBe("degraded");
		expect(reportSeverity(makeReport("wechat", [], false))).toBe("info");
	});

	test("uses the shared severity glyphs", () => {
		expect(severityGlyph("missing", fakeTheme)).toBe(GLYPHS.doctorMissing);
		expect(severityGlyph("degraded", fakeTheme)).toBe(GLYPHS.doctorWarn);
		expect(severityGlyph("ok", fakeTheme)).toBe(GLYPHS.doctorOk);
	});

	test("keeps every row inside the width", () => {
		for (const width of [12, 20, 33, 80]) {
			expect(visibleWidth(extensionRow(missing, fakeTheme, width, true))).toBeLessThanOrEqual(width);
		}
	});

	test("marks the selected row", () => {
		expect(extensionRow(ok, fakeTheme, 40, true)).toContain("❯");
		expect(extensionRow(ok, fakeTheme, 40, false)).not.toContain("❯");
	});

	test("wraps detail to the width and caps it at the row budget", () => {
		const long = makeReport("document", [makeFinding("pdfcraft-cli", "missing", "x".repeat(200))]);
		const lines = detailLines(long, fakeTheme, 40, 3);
		expect(lines.length).toBe(3);
		expect(lines.at(-1)).toContain("…");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});

	test("shows the hint indented under its finding", () => {
		const lines = detailLines(missing, fakeTheme, 60, 4);
		expect(lines.join("\n")).toContain("→ cargo install");
	});

	test("shows notes only once the screen is expanded", () => {
		const report = makeReport("status-bar", [makeFinding("platform", "info", "TUI only")]);
		expect(detailLines(report, fakeTheme, 60, 4).join("\n")).toContain("no problems");
		expect(detailLines(report, fakeTheme, 60, 4, true).join("\n")).toContain("TUI only");
	});
});
