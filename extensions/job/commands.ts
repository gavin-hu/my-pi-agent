/**
 * Slash commands for the jobs extension.
 *
 * One `/jobs` command opens an interactive list (select, view logs, kill,
 * clear) in the TUI, and prints a text summary everywhere else.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withPolledScreen } from "../../lib/screen-session.ts";
import { formatJobList } from "./format.ts";
import type { JobsRuntime } from "./runtime.ts";
import { JobListComponent } from "./tui.ts";

/** How often the open log pane re-reads the log file. */
const LOG_POLL_MS = 500;

export function registerCommands(pi: ExtensionAPI, runtime: JobsRuntime): void {
	pi.registerCommand("jobs", {
		description: "Show and manage background jobs",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify(formatJobList(runtime.list()), "info");
				return;
			}

			await withPolledScreen(
				pi,
				ctx,
				(screen) =>
					new JobListComponent(
						() => runtime.list(),
						screen.theme,
						{
							sessionId: () => runtime.sessionId,
							logs: (id) => runtime.logs(id, 200),
							kill: (id) => {
								runtime.kill(id);
							},
							clear: () => {
								const result = runtime.clear(undefined, false);
								if (result.cleared > 0) {
									ctx.ui.notify(`Cleared ${result.cleared} job${result.cleared === 1 ? "" : "s"}.`, "info");
								}
							},
						},
						screen.close,
						screen.requestRender,
						screen.viewportRows,
					),
				{
					pollMs: LOG_POLL_MS,
					// Only the open log pane is polled; the runtime's own clock repaints the list.
					poll: (component) => {
						const id = component.currentLogId();
						if (id) component.refreshLogs(id);
					},
				},
			);
		},
	});
}
