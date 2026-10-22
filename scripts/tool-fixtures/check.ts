/**
 * The verification runs: `run_doctor`, and `run_check` in three states.
 *
 * A passing run draws as one line, a failing one lists its failures, and a
 * failure that parsed into no location leads with its tail instead.
 */

import { formatCheckReport } from "../../extensions/check/format.ts";
import type { CheckResult } from "../../extensions/check/types.ts";
import type { ToolFixture } from "./types.ts";

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
			content: [{ type: "text", text: "doctor: 1 missing, 1 degraded across 17 extensions" }],
			details: {
				headline: "doctor: 1 missing, 1 degraded across 17 extensions",
				missing: 1,
				degraded: 1,
				extensions: [
					{
						extension: "wechat",
						enabled: true,
						findings: [
							{
								check: "state file",
								severity: "missing",
								detail: "not logged in",
								hint: "run /wechat login to start the bridge",
							},
							{ check: "qrcode", severity: "ok", detail: "package present" },
						],
					},
					{
						extension: "file-read",
						enabled: true,
						findings: [
							{
								check: "unpdf",
								severity: "degraded",
								detail: "optional PDF extractor not installed",
								hint: "bun add unpdf to read PDFs",
							},
							{ check: "node", severity: "ok", detail: "v22.5.0 on PATH" },
						],
					},
				],
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
