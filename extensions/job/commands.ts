/**
 * Slash commands for the jobs extension.
 *
 * One `/jobs` command opens an interactive list (select, view logs, kill,
 * clear) in the TUI, and prints a text summary everywhere else.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withRailsSuppressed } from "../../lib/rails.ts";
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

			let timer: ReturnType<typeof setInterval> | undefined;
			const stopTimer = (): void => {
				if (timer) clearInterval(timer);
				timer = undefined;
			};

			// The dock screen owns the editor slot; hide the rails for its lifetime.
			try {
				await withRailsSuppressed(pi, () =>
					ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
						const component = new JobListComponent(
							() => runtime.list(),
							theme,
							{
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
							() => {
								stopTimer();
								done();
							},
							() => tui.requestRender(),
							() => tui.terminal?.rows,
						);

						// Poll the open log pane; the runtime's own clock repaints the list.
						timer = setInterval(() => {
							const id = component.currentLogId();
							if (id) component.refreshLogs(id);
						}, LOG_POLL_MS);
						timer.unref?.();

						return component;
					}),
				);
			} finally {
				stopTimer();
			}
		},
	});
}
