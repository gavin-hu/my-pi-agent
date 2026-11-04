/**
 * The doctor report: one `run_doctor` result with a missing finding and a
 * degraded one, so the headline's counts and the indented body both show work.
 */

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
			hint: "run /wechat login, then /wechat start",
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

/** The gallery entry for the doctor report. */
export const DOCTOR_FIXTURES: ToolFixture[] = [
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
];
