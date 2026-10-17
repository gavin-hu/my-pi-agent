/**
 * The `run_doctor` tool.
 *
 * Read-only by design, and honest about it: it spawns `<binary> --version`
 * probes, lazily imports optional packages, and reads config files, and it never
 * changes anything. That `readOnlyHint` is what lets plan mode allow it through
 * the shared default-deny policy in `lib/policy.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../../lib/format.ts";
import { missingFindings } from "../../../lib/requirements.ts";
import { reuseText, toolDetails } from "../../../lib/tui/chrome.ts";
import {
	elapsedSuffix,
	rejectionLine,
	reuseCallText,
	startToolProgress,
	syncElapsedTimer,
	toolCallTitle,
} from "../../../lib/tui/tool.ts";
import { expandHint } from "../../../lib/tui/glyphs.ts";
import { paint, type TuiRole } from "../../../lib/tui/tokens.ts";
import { formatExtension, formatReport, isProblemSeverity } from "./format.ts";
import type { DoctorRuntime } from "./runtime.ts";
import { DoctorOutput, DoctorParams, TOOL_NAME, type DoctorArgs, type DoctorStructured } from "./schema.ts";

export { TOOL_NAME };

/** Transcript summary: the headline plus each problem, capped. */
function summaryLines(structured: DoctorStructured | undefined, limit = 6): string[] {
	if (!structured) return ["doctor: no result"];
	const lines = [structured.headline];
	const problems = structured.extensions.flatMap((extension) =>
		extension.findings
			.filter((finding) => isProblemSeverity(finding.severity))
			.map((finding) => `${extension.extension}: ${finding.check} — ${finding.detail}`),
	);
	for (const problem of problems.slice(0, limit)) lines.push(`  ${problem}`);
	if (problems.length > limit) lines.push(`  … ${problems.length - limit} more`);
	return lines;
}

/** Register the read-only `run_doctor` tool. */
export function registerTools(pi: ExtensionAPI, runtime: DoctorRuntime): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Run doctor",
		description:
			"Report whether each extension has what it needs at runtime: binaries on PATH, optional packages and browsers, " +
			"login/state files, and config files that fail to parse. Read-only; it probes and changes nothing.",
		promptSnippet: "Check each extension's runtime prerequisites and what is missing.",
		promptGuidelines: [
			"Run doctor before concluding an extension is broken — enabled but inert, or a tool reported a missing dependency.",
			"A `degraded` finding means reduced capability, not a failure; `missing` means an enabled extension cannot work.",
			"Findings carry the install command or the fix in `hint`; quote that hint rather than inventing one.",
		],
		parameters: DoctorParams,
		outputSchema: DoctorOutput,
		exposure: "direct",
		defaultActive: true,
		annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },

		async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
			const args = params as DoctorArgs;
			startToolProgress(onUpdate);
			const reports = await runtime.probeAll({ refresh: args.refresh === true });
			const selected = args.extension ? reports.filter((report) => report.extension === args.extension) : reports;

			if (args.extension && selected.length === 0) {
				throw new Error(
					`No extension named "${args.extension}". Known extensions: ${reports
						.map((report) => report.extension)
						.join(", ")}.`,
				);
			}

			const single = args.extension ? selected[0] : undefined;
			const text = single ? formatExtension(single) : formatReport(selected);
			const structured: DoctorStructured = {
				headline: text.split("\n")[0] ?? "",
				missing: missingFindings(selected).length,
				degraded: selected.flatMap((report) => report.findings).filter((finding) => finding.severity === "degraded")
					.length,
				extensions: selected.map((report) => ({
					extension: report.extension,
					enabled: report.enabled,
					findings: report.findings.map((finding) => ({
						check: finding.check,
						severity: finding.severity,
						detail: finding.detail,
						...(finding.hint === undefined ? {} : { hint: finding.hint }),
					})),
				})),
			};

			return {
				content: [{ type: "text", text }],
				details: structured,
				structuredContent: structured,
			};
		},

		renderCall(args, theme, context) {
			const input = args as DoctorArgs;
			const scope = typeof input.extension === "string" && input.extension ? sanitizeLine(input.extension) : "";
			const text = reuseCallText(context?.lastComponent);
			text.setText(
				`${toolCallTitle(theme, TOOL_NAME)}${scope ? ` ${paint(theme, "label", scope)}` : ""}${input.refresh ? paint(theme, "faint", " (refresh)") : ""}`,
			);
			return text;
		},

		renderResult(result, options, theme, context) {
			const startedAt = syncElapsedTimer(options.isPartial, context);
			const structured = toolDetails<DoctorStructured>(result.details);
			const tone: TuiRole = (structured?.missing ?? 0) > 0 ? "bad" : (structured?.degraded ?? 0) > 0 ? "warn" : "ok";
			const text = reuseText(context?.lastComponent);
			if (options.isPartial) {
				const elapsed = startedAt === undefined ? "" : elapsedSuffix(theme, Date.now() - startedAt);
				text.setText(paint(theme, "warn", "Probing…") + elapsed);
				return text;
			}
			if (!structured) {
				text.setText(rejectionLine(theme, result, options.expanded));
				return text;
			}
			const problems = structured.missing + structured.degraded;
			if (!options.expanded) {
				const hint = problems > 0 ? ` ${expandHint(theme)}` : "";
				text.setText(paint(theme, tone, structured.headline) + hint + elapsedSuffix(theme, context.durationMs));
				return text;
			}
			text.setText(paint(theme, tone, summaryLines(structured).join("\n")) + elapsedSuffix(theme, context.durationMs));
			return text;
		},
	});
}
