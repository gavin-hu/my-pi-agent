import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import type { Finding } from "../../../lib/requirements.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { fakeTheme } from "../../../test/helpers/fakes.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import {
	countFindings,
	detailLines,
	formatExtension,
	formatHeadline,
	formatReport,
	formatWarning,
	hasProblems,
	reportSeverity,
	severityGlyph,
	warningNotice,
} from "./format.ts";

const ok = makeReport("todo", [makeFinding("todo.json", "ok")]);
const missing = makeReport("worktree", [
	makeFinding("git", "missing", "not found on PATH — worktree isolation", "install git"),
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
		expect(text).toContain("git: not found on PATH");
		expect(text).toContain("→ install git");
		expect(text).not.toContain("todo");
	});

	test("lists notes when nothing is wrong", () => {
		const text = formatReport([makeReport("bytefly", [makeFinding("platform", "info", "TUI only")])]);
		expect(text).toContain("Notes:");
		expect(text).toContain("bytefly: TUI only");
	});

	test("shows every finding — including passing checks — for one extension", () => {
		const text = formatExtension(makeReport("worktree", [makeFinding("git", "ok"), ...missing.findings]));
		expect(text).toContain("worktree");
		expect(text).toContain("git: git detail");
		expect(text).toContain("git");
	});

	test("names the extension and the fix in the proactive warning", () => {
		expect(formatWarning(missing.findings)).toBe("doctor: missing worktree (git) — run /bytefly doctor");
	});

	test("sanitizes anything a probe produced", () => {
		const nasty = makeReport("worktree", [makeFinding("git", "missing", "failed\u001b[31m\u0007 to start")]);
		expect(formatReport([nasty])).not.toContain("\u001b");
		expect(formatReport([nasty])).not.toContain("\u0007");
	});
});

describe("the transcript notice", () => {
	const finding = (extension: string, check: string, hint?: string): Finding => ({
		extension,
		check,
		severity: "missing",
		detail: `${check} is not installed`,
		...(hint === undefined ? {} : { hint }),
	});

	test("is a visible notice whose content is the warning sentence", () => {
		const findings = [finding("worktree", "git", "install git")];
		const notice = warningNotice(findings);
		expect(notice.customType).toBe(NOTICE_TYPE);
		expect(notice.display).toBe(true);
		expect(notice.content).toBe(formatWarning(findings));
		expect(notice.content).toContain("run /bytefly doctor");
	});

	test("is one bad row per missing finding, titled with the count", () => {
		const two = warningNotice([finding("worktree", "git", "install git"), finding("web-access", "unpdf")]);
		expect(two.details.source).toBe("doctor");
		expect(two.details.title).toBe("2 missing prerequisites");
		expect(two.details.severity).toBe("bad");
		expect(two.details.items).toEqual([
			{ label: "worktree (git)", detail: "install git", severity: "bad" },
			{ label: "web-access (unpdf)", detail: "unpdf is not installed", severity: "bad" },
		]);

		const one = warningNotice([finding("worktree", "git")]);
		expect(one.details.title).toBe("1 missing prerequisite");
	});

	test("sanitizes everything a probe produced", () => {
		const notice = warningNotice([finding("worktree\u001b[31m", "git", "run \u0007it")]);
		const text = `${notice.content}${JSON.stringify(notice.details)}`;
		expect(text).not.toContain("\u001b");
		expect(text).not.toContain("\u0007");
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
		expect(severityGlyph("missing", fakeTheme)).toBe(GLYPHS.cross);
		expect(severityGlyph("degraded", fakeTheme)).toBe(GLYPHS.warn);
		expect(severityGlyph("ok", fakeTheme)).toBe(GLYPHS.check);
		expect(severityGlyph("info", fakeTheme)).toBe(GLYPHS.disabled);
	});

	test("wraps detail to the width and caps it at the row budget", () => {
		const long = makeReport("worktree", [makeFinding("git", "missing", "x".repeat(200))]);
		const lines = detailLines(long, fakeTheme, 40, 3);
		expect(lines.length).toBe(3);
		expect(lines.at(-1)).toContain("…");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});

	test("shows the hint indented under its finding", () => {
		const lines = detailLines(missing, fakeTheme, 60, 4);
		expect(lines.join("\n")).toContain("→ install git");
	});

	test("shows notes only once the screen is expanded", () => {
		const report = makeReport("bytefly", [makeFinding("platform", "info", "TUI only")]);
		expect(detailLines(report, fakeTheme, 60, 4).join("\n")).toContain("no problems");
		expect(detailLines(report, fakeTheme, 60, 4, true).join("\n")).toContain("TUI only");
	});
});
