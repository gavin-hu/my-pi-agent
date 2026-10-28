/**
 * The verification runs: `run_doctor`, and `run_check` in three states.
 *
 * A passing run draws as one line, a failing one lists its failures, and a
 * failure that parsed into no location leads with its tail instead.
 */

import { formatCheckReport } from "../../../extensions/check/format.ts";
import type { CheckResult } from "../../../extensions/check/types.ts";
import { countFindings, formatHeadline } from "../../../extensions/bytefly/doctor/format.ts";
import type { ExtensionReport, Finding } from "../../../lib/requirements.ts";
import pkg from "../../../package.json";
import type { ToolFixture } from "./types.ts";

/**
 * The findings the doctor demo shows a problem on: one missing, one degraded.
 * Every other shipped extension is reported ready, so the headline's count is
 * the manifest's rather than a number typed here that can rot.
 */
const DOCTOR_PROBLEMS: Record<string, Omit<Finding, "extension">[]> = {
	wechat: [
		{
			check: "state file",
			severity: "missing",
			detail: "not logged in",
			hint: "run /wechat login to start the bridge",
		},
		{ check: "qrcode", severity: "ok", detail: "package present" },
	],
	"file-read": [
		{
			check: "unpdf",
			severity: "degraded",
			detail: "optional PDF extractor not installed",
			hint: "bun add unpdf to read PDFs",
		},
		{ check: "node", severity: "ok", detail: "v22.5.0 on PATH" },
	],
};

/** One report per extension the package loads, in manifest order. */
const DOCTOR_REPORTS: ExtensionReport[] = pkg.pi.extensions.map((entry) => {
	const extension = entry.split("/")[2] ?? entry;
	const findings: Omit<Finding, "extension">[] = DOCTOR_PROBLEMS[extension] ?? [
		{ check: "session", severity: "ok", detail: "loaded" },
	];
	return {
		extension,
		enabled: true,
		findings: findings.map((finding) => ({ ...finding, extension })),
	};
});

/** The demo's counts, from the same reports the headline names. */
const DOCTOR_COUNTS = countFindings(DOCTOR_REPORTS);

/** A failing run whose output parsed into locations. */
const CHECK_FAILED: CheckResult = {
	target: "all",
	status: "failed",
	commands: ["bun run check"],
	exitCode: 1,
	durationMs: 12_400,
	truncated: false,
	failures: [
		{
			path: "extensions/check/detect.test.ts",
			line: 88,
			column: 5,
			message: "expected cargo test",
			command: "bun run check",
		},
		{
			path: "extensions/check/failures.test.ts",
			line: 41,
			message: "expected 2 failures",
			command: "bun run check",
		},
	],
	tail: "src/check.test.ts:12: nope\nmore output",
};

/** A passing run, which draws as one line. */
const CHECK_PASSED: CheckResult = {
	target: "test",
	status: "passed",
	commands: ["bun run test"],
	exitCode: 0,
	durationMs: 12_400,
	truncated: false,
	failures: [],
	tail: "",
};

/** A failing run whose output parsed no location, so the tail is the evidence. */
const CHECK_UNPARSED: CheckResult = {
	target: "all",
	status: "failed",
	commands: ["make verify"],
	exitCode: 2,
	durationMs: 3_100,
	truncated: false,
	failures: [{ message: "Command exited with status 2", command: "make verify" }],
	tail: [
		"linking src/http.ts",
		"linking src/router.ts",
		"warning: unused export 'routeTable'",
		"warning: unused export 'traceId'",
		"linking src/server.ts",
		"linking src/index.ts",
		"make: *** [verify] Error 2",
	].join("\n"),
};

/** One entry per verification tool, in gallery order. */
export const CHECK_FIXTURES: ToolFixture[] = [
	{
		name: "run_doctor",
		group: "package",
		label: "a doctor report with a missing and a degraded finding",
		args: { extension: "bytefly" },
		result: {
			content: [{ type: "text", text: formatHeadline(DOCTOR_REPORTS) }],
			details: {
				headline: formatHeadline(DOCTOR_REPORTS),
				missing: DOCTOR_COUNTS.missing,
				degraded: DOCTOR_COUNTS.degraded,
				extensions: DOCTOR_REPORTS,
			},
		},
	},
	{
		name: "run_check",
		group: "package",
		label: "a failed run with parsed failures",
		args: { target: "all" },
		result: { content: [{ type: "text", text: formatCheckReport(CHECK_FAILED) }], details: CHECK_FAILED },
	},
	{
		name: "run_check-passed",
		tool: "run_check",
		group: "package",
		label: "a passing run in one line",
		args: { target: "test" },
		result: { content: [{ type: "text", text: formatCheckReport(CHECK_PASSED) }], details: CHECK_PASSED },
	},
	{
		name: "run_check-unparsed",
		tool: "run_check",
		group: "package",
		label: "a failed run whose output parsed no location",
		args: { target: "all" },
		result: { content: [{ type: "text", text: formatCheckReport(CHECK_UNPARSED) }], details: CHECK_UNPARSED },
	},
];
