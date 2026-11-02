/**
 * The red gate's report: what a JUnit file says, and the lines a red run prints from it.
 *
 * The fixtures are what bun 1.4.3 actually wrote — a passing case and a failing one inside two
 * `describe`s, and the totals `bun test` computed — because the shape is bun's and the scanner
 * is only as good as its sample. The cases that matter are the ones a naive scan gets wrong: a
 * self-closing `<testcase />` standing before a failing one, an escaped `classname` chain, and a
 * report with no case at all.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import { MAX_LISTED, REPORT_FILE, readReport, reportDigest, reportPath } from "./junit.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One report in a temp directory, and its path. */
function report(xml: string): string {
	const path = join(temps.track(tempDir("pi-junit-")), "test-report.xml");
	writeFileSync(path, xml, "utf-8");
	return path;
}

/** A report of one file with `cases` inside it, as `bun test --reporter=junit` writes one. */
function oneFile(cases: string, totals = 'tests="2" assertions="2" failures="1" skipped="0" time="0.004"'): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" ${totals}>
  <testsuite name="scripts/thing.test.ts" file="scripts/thing.test.ts" tests="2" assertions="2" failures="1" skipped="0" time="0.003">
${cases}
  </testsuite>
</testsuites>
`;
}

/** The failing case bun wrote for `fails here` inside `describe("outer") > describe("inner")`. */
const NESTED_FAILURE = `        <testcase name="fails here" classname="inner &gt; outer" time="0.000211" file="scripts/thing.test.ts" line="4" assertions="1">
          <failure type="AssertionError" message="expect(received).toBe(expected)&#10;&#10;Expected: 2&#10;Received: 1&#10;">AssertionError: expect(received).toBe(expected)&#10;&#10;Expected: 2&#10;Received: 1&#10;&#10;</failure>
        </testcase>`;

describe("reportPath", () => {
	test("names a file under the repository's ignored state directory", () => {
		expect(reportPath("/repo")).toBe(join("/repo", REPORT_FILE));
		expect(REPORT_FILE).toBe(join(".pi", "cache", "test-report.xml"));
	});
});

describe("readReport", () => {
	test("reads the totals and the one failing case, with its line, chain, and time", () => {
		const path = report(
			oneFile(
				`        <testcase name="passes" classname="inner &gt; outer" time="0.000011" file="scripts/thing.test.ts" line="5" assertions="1" />
${NESTED_FAILURE}`,
			),
		);
		expect(readReport(path)).toEqual({
			tests: 2,
			failures: 1,
			skipped: 0,
			seconds: 0.004,
			failing: [
				{ file: "scripts/thing.test.ts", line: 4, name: "fails here", suite: "inner > outer", seconds: 0.000211 },
			],
		});
	});

	test("leaves a self-closing case out of the failing list rather than swallowing the next one", () => {
		// A scan that pairs `<testcase …>` with the next `</testcase>` reads the passing case as a
		// container for the failing one: the case before a red would then be named as a red.
		const path = report(
			oneFile(
				`        <testcase name="passes" classname="" time="0.000011" file="scripts/thing.test.ts" line="5" assertions="1" />
${NESTED_FAILURE}`,
			),
		);
		expect(readReport(path)?.failing.map((failure) => failure.name)).toEqual(["fails here"]);
	});

	test("reads a case that names no file as its suite's, and keeps one with no chain, line, or time", () => {
		const path = report(
			oneFile(
				`        <testcase name="fails here">
          <failure type="Error" message="boom">Error: boom</failure>
        </testcase>`,
			),
		);
		expect(readReport(path)?.failing).toEqual([{ file: "scripts/thing.test.ts", name: "fails here" }]);
	});

	test("answers a green report with no failing cases", () => {
		const path = report(
			oneFile(
				`        <testcase name="passes" file="scripts/thing.test.ts" line="2" />`,
				'tests="2" assertions="2" failures="0" skipped="1" time="0.5"',
			),
		);
		expect(readReport(path)).toMatchObject({ tests: 2, failures: 0, skipped: 1, failing: [] });
	});

	test("answers undefined for a file that is not there, and for one that is not a report", () => {
		const missing = join(temps.track(tempDir("pi-junit-")), "none.xml");
		expect(readReport(missing)).toBeUndefined();
		// A suite that failed to load leaves bun writing no file at all; anything else on the path
		// is somebody else's file, and a scan of it is not a report.
		expect(readReport(report("not xml at all\n"))).toBeUndefined();
		expect(readReport(report(`<testsuites name="bun test">\n</testsuites>\n`))).toBeUndefined();
	});
});

describe("reportDigest", () => {
	test("names the report, the count and the wall time, then one line per failing case", () => {
		const path = report(
			oneFile(NESTED_FAILURE, 'tests="7237" assertions="32873" failures="1" skipped="131" time="34.62"'),
		);
		expect(reportDigest(path)).toBe(
			[
				`test report — ${path}`,
				"  failures (1 of 7237 in 34.62s, 131 skipped):",
				"    scripts/thing.test.ts:4 — inner > outer > fails here (0.00s)",
			].join("\n"),
		);
	});

	test("lists the first cases and counts the rest, so a wide red stays readable", () => {
		const path = report(
			oneFile(
				Array.from(
					{ length: MAX_LISTED + 5 },
					(_, index) =>
						`        <testcase name="fails ${index}" file="scripts/thing.test.ts" line="${index + 1}">\n          <failure type="Error" message="boom">Error: boom</failure>\n        </testcase>`,
				).join("\n"),
			),
		);
		const lines = reportDigest(path).split("\n");
		expect(lines).toHaveLength(2 + MAX_LISTED + 1);
		expect(lines.at(-1)).toBe(`    … 5 more in the report`);
	});

	test("says no report was written, because a suite that could not load keeps its error above", () => {
		const missing = join(temps.track(tempDir("pi-junit-")), "never.xml");
		expect(reportDigest(missing)).toBe(
			`test report — none written: a suite that could not be loaded keeps its error above (${missing})`,
		);
	});
});
