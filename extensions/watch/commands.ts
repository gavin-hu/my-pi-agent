/**
 * Slash commands for the watch extension.
 *
 * A bare `/watch` opens an interactive list (select, view matches, stop, clear)
 * in the TUI and prints a text summary everywhere else. `/watch list`,
 * `/watch matches <id>`, `/watch logs <id>`, `/watch stop <id>`, and
 * `/watch clear [all]` work in every mode without opening a screen.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withRailsSuppressed } from "../../lib/rails.ts";
import { formatWatchList, shortLabel } from "./format.ts";
import type { WatchRuntime } from "./runtime.ts";
import { WatchListComponent } from "./tui.ts";

/** How often the open screen re-reads live state. */
const POLL_MS = 500;

const SUBCOMMANDS = [
	{ value: "list", label: "list" },
	{ value: "matches", label: "matches <id>" },
	{ value: "logs", label: "logs <id>" },
	{ value: "stop", label: "stop <id>" },
	{ value: "clear", label: "clear [all]" },
];

export function registerCommands(pi: ExtensionAPI, runtime: WatchRuntime): void {
	pi.registerCommand("watch", {
		description: "Show and manage watchers",
		getArgumentCompletions: (prefix) => {
			const [action = "", argument, ...rest] = prefix.trimStart().split(/\s+/);
			if (rest.length > 0) return null;
			if (argument === undefined) {
				const items = SUBCOMMANDS.filter((item) => item.value.startsWith(action));
				return items.length > 0 ? items.map((item) => ({ ...item, value: `${item.value} ` })) : null;
			}
			if (action === "matches" || action === "logs" || action === "stop") {
				const items = runtime
					.list()
					.filter((watch) => watch.id.startsWith(argument))
					.map((watch) => ({ value: watch.id, label: `${watch.id} ${shortLabel(watch)}` }));
				return items.length > 0 ? items : null;
			}
			return null;
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const sub = parts[0] ?? "";
			const id = parts[1];

			if (sub === "matches" || sub === "logs") {
				if (!id) {
					ctx.ui.notify(`/watch ${sub} <id>`, "warning");
					return;
				}
				const result = sub === "matches" ? runtime.matches(id) : runtime.logs(id);
				if (!result) {
					ctx.ui.notify(`no watcher "${id}".`, "error");
					return;
				}
				ctx.ui.notify(result.lines.length > 0 ? result.lines.join("\n") : `no ${sub} yet.`, "info");
				return;
			}

			if (sub === "stop") {
				if (!id) {
					ctx.ui.notify("/watch stop <id>", "warning");
					return;
				}
				const stopped = runtime.stop(id);
				ctx.ui.notify(stopped ? `Stopped ${id}.` : `${id} was not running.`, "info");
				return;
			}

			if (sub === "clear") {
				const result = runtime.clear(undefined, parts[1] === "all");
				if (result.refused) {
					ctx.ui.notify(result.refused, "warning");
					return;
				}
				ctx.ui.notify(result.cleared > 0 ? `Cleared ${result.cleared}.` : "Nothing to clear.", "info");
				return;
			}

			if (sub === "list") {
				ctx.ui.notify(formatWatchList(runtime.list()), "info");
				return;
			}

			if (ctx.mode !== "tui") {
				ctx.ui.notify(formatWatchList(runtime.list()), "info");
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
						const component = new WatchListComponent(
							() => runtime.list(),
							theme,
							{
								lines: (watchId) => runtime.matches(watchId, 500),
								stop: (watchId) => {
									runtime.stop(watchId);
								},
								clear: () => {
									const result = runtime.clear(undefined, false);
									if (result.cleared > 0) {
										ctx.ui.notify(`Cleared ${result.cleared} watcher${result.cleared === 1 ? "" : "s"}.`, "info");
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

						timer = setInterval(() => {
							runtime.tick();
							const open = component.currentLineId();
							if (open) component.refreshLines(open);
							tui.requestRender();
						}, POLL_MS);
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
