/**
 * The `run_doctor` tool.
 *
 * Read-only by design, and honest about it: it spawns `<binary> --version`
 * probes, lazily imports optional packages, and reads config files, and it never
 * changes anything. That `readOnlyHint` is what lets plan mode allow it through
 * the shared default-deny policy in `lib/policy.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { missingFindings } from "../../lib/requirements.ts";
import { formatExtension, formatReport } from "./format.ts";
import type { DoctorRuntime } from "./runtime.ts";
import { DoctorOutput, DoctorParams, TOOL_NAME, type DoctorArgs, type DoctorStructured } from "./schema.ts";

export { TOOL_NAME };

/** Reuse the result component across renders, as every TUI tool must. */
function reuseText(last: unknown, text: string): Text {
	const component = last instanceof Text ? last : new Text("", 0, 0);
	component.setText(text);
	return component;
}

/** Transcript summary: the headline plus each problem, capped. */
function summaryLines(structured: DoctorStructured | undefined, limit = 6): string[] {
	if (!structured) return ["doctor: no result"];
	const lines = [structured.headline];
	const problems = structured.extensions.flatMap((extension) =>
		extension.findings
			.filter((finding) => finding.severity === "missing" || finding.severity === "degraded")
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
			"Report whether each extension in this package has what it needs at runtime: external binaries on PATH, optional npm " +
			"packages and browsers, login/state files, and config files that fail to parse. Use it when an extension is enabled " +
			"but appears to do nothing, before concluding a tool is broken, or after a tool reported a missing dependency. " +
			"Read-only: it probes (`<binary> --version`, lazy imports, config parsing) and changes nothing.",
		promptSnippet: "Check that each extension's runtime prerequisites are met, and see what is missing.",
		promptGuidelines: [
			"Run doctor before telling the user an extension is broken or a feature is unavailable.",
			"A `degraded` finding means reduced capability, not a failure; `missing` means an enabled extension cannot work.",
			"Findings carry the install command or the fix in `hint`; quote that hint rather than inventing one.",
			"Pass `extension` to focus on one extension, and `refresh` when something changed during the session.",
		],
		parameters: DoctorParams,
		outputSchema: DoctorOutput,
		exposure: "direct",
		defaultActive: true,
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const args = params as DoctorArgs;
			const reports = await runtime.probeAll({ refresh: args.refresh === true });
			const selected = args.extension ? reports.filter((report) => report.extension === args.extension) : reports;

			if (args.extension && selected.length === 0) {
				throw new Error(
					`No extension named "${args.extension}". Known extensions: ${reports
						.map((report) => report.extension)
						.join(", ")}.`,
				);
			}

			const text = args.extension ? formatExtension(selected[0]!) : formatReport(selected);
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
			const scope = `${input.extension ? ` ${input.extension}` : ""}${input.refresh ? " (refresh)" : ""}`;
			return reuseText(context?.lastComponent, `${theme.fg("toolTitle", "doctor")}${theme.fg("dim", scope)}`);
		},

		renderResult(result, _options, theme, context) {
			const structured = result.details as DoctorStructured | undefined;
			const tone = (structured?.missing ?? 0) > 0 ? "error" : (structured?.degraded ?? 0) > 0 ? "warning" : "success";
			return reuseText(context?.lastComponent, theme.fg(tone, summaryLines(structured).join("\n")));
		},
	});
}
