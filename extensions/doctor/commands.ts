/**
 * The `/doctor` command.
 *
 * One command for the whole surface: `/doctor` reports everything, `/doctor
 * document` narrows it, `/doctor refresh` re-probes. The TUI opens a docked
 * list screen; every other mode prints the same report as text.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withRailsSuppressed } from "../../lib/rails.ts";
import { REQUIREMENTS, type ExtensionReport } from "../../lib/requirements.ts";
import { formatExtension, formatReport, hasProblems } from "./format.ts";
import type { DoctorRuntime } from "./runtime.ts";
import { DoctorScreen } from "./tui.ts";

/** The report text for a set of reports, narrowed when one extension was named. */
function reportText(name: string | undefined, reports: readonly ExtensionReport[]): string {
	const first = reports[0];
	return name && first ? formatExtension(first) : formatReport(reports);
}

/** Register the `/doctor` command. */
export function registerCommands(pi: ExtensionAPI, runtime: DoctorRuntime): void {
	pi.registerCommand("doctor", {
		description: "Check that every extension has what it needs: /doctor [extension] [refresh]",
		getArgumentCompletions: (prefix: string) => {
			const options = [...Object.keys(REQUIREMENTS), "refresh"].filter((option) => option.startsWith(prefix));
			return options.length > 0 ? options.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const refresh = parts.includes("refresh");
			const name = parts.find((part) => part !== "refresh");

			const reports = await runtime.probeAll({ refresh });
			if (name && !reports.some((report) => report.extension === name)) {
				ctx.ui.notify(`doctor: no extension named "${name}"`, "warning");
				return;
			}
			const selected = name ? reports.filter((report) => report.extension === name) : reports;

			if (ctx.mode !== "tui") {
				ctx.ui.notify(reportText(name, selected), hasProblems(selected) ? "warning" : "info");
				return;
			}

			// The dock screen owns the editor slot; hide the rails for its lifetime.
			let current = selected;
			await withRailsSuppressed(pi, () =>
				ctx.ui.custom<void>(
					(tui, theme, _keybindings, done) =>
						new DoctorScreen({
							reports: () => current,
							rows: () => tui.terminal?.rows,
							theme,
							requestRender: () => tui.requestRender(),
							refresh: async () => {
								const next = await runtime.probeAll({ refresh: true });
								current = name ? next.filter((report) => report.extension === name) : next;
								tui.requestRender();
							},
							done,
						}),
				),
			);
		},
	});
}
