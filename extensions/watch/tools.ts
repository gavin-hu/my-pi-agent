/**
 * Model-facing registration for the `watch` tool.
 *
 * One tool with seven actions: `add`, `list`, `status`, `matches`, `logs`,
 * `stop`, `clear`. A watcher outlives the tool call, so `add` returns
 * immediately with an id; the model reads matches with `matches` and raw output
 * with `logs`. Failures come back as an error result.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { errorResult, textResult } from "../../lib/tool-result.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { callLine, detailsOrLine, rejectionLine } from "../../lib/tui/tool.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { paint } from "../../lib/tui/tokens.ts";
import {
	compareWatches,
	formatCallText,
	formatPattern,
	formatTail,
	formatWatchList,
	formatWatchOutcomeLine,
	formatWatchStatus,
	sourceLabel,
} from "./format.ts";
import type { WatchRuntime } from "./runtime.ts";
import { WatchParams, normalizeCall, type WatchArgs, type WatchCall } from "./schema.ts";
import { WatchResult, type WatchResultInput } from "./render.ts";
import { WATCH_FIELDS, type WatchDetails, type WatchRecord } from "./types.ts";

export const TOOL_NAME = "watch";

/** Collapsed transcript rows before the result is truncated. */
const RESULT_ROWS = 8;

const GUIDELINES = [
	"Use `watch add` to tail a log file or a long-running command and surface lines matching a pattern.",
	"Read matches with `watch matches <id>`; use `watch logs <id>` for the raw output tail.",
	"Add `wake: true` only when a match should start a turn immediately; otherwise matches are reported at the next turn.",
	"Use `watch stop <id>` to stop a watcher and `watch clear` to drop stopped ones.",
];

/** The sentence a `clear` appends when it left watchers running: what still runs, and the door out. */
function stillRunning(watches: readonly WatchRecord[]): string {
	const ids = watches.filter((watch) => watch.status === "running").map((watch) => watch.id);
	if (ids.length === 0) return "";
	return ids.length === 1
		? `${ids[0]} is running; pass all:true to stop it.`
		: `${ids.join(", ")} are running; pass all:true to stop them.`;
}

export function registerTools(pi: ExtensionAPI, runtime: WatchRuntime): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Watch",
		description:
			"Tail a file or a command's output and match each new line against a regular expression. Actions: `add` " +
			"(returns a watcher id immediately), `list`, `status`/`matches`/`logs`/`stop` (by id), and `clear`. " +
			"Matching lines are reported to you at the next turn, or wake a turn when the watcher was added `wake: true`. " +
			"Watchers are stopped when the session ends.",
		promptSnippet:
			"Tail a file or command and alert on pattern matches (add, list, status, matches, logs, stop, clear).",
		promptGuidelines: GUIDELINES,
		parameters: WatchParams,
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as WatchArgs;
			let call: WatchCall;
			try {
				call = normalizeCall(args);
			} catch (error) {
				return errorResult(args?.action ?? "list", (error as Error).message);
			}
			// After the action is known and before the dispatch: a field this verb never reads would
			// otherwise be dropped in silence. It loads here rather than at registration, and outside the
			// schema's normalizer, whose job is parsing; the refusal is policy.
			const { strayField } = await import("../../lib/stray-fields.ts");
			const stray = strayField(call.action, args, WATCH_FIELDS);
			if (stray !== undefined) return errorResult(call.action, stray);

			try {
				switch (call.action) {
					case "add": {
						const watch = runtime.add(
							{
								path: call.path,
								command: call.command,
								cwd: call.cwd,
								pattern: call.pattern,
								exclude: call.exclude,
								caseSensitive: call.caseSensitive,
								label: call.label,
								wake: call.wake,
								fromStart: call.fromStart,
							},
							ctx as ExtensionContext,
						);
						const pattern = formatPattern(watch);
						// `wake` is its own line because the pattern is printed whole: a model copies that string
						// back into `add`, and a badge glued to it would come back as part of the expression.
						const wake = watch.wake ? "\nWake: on — a match raises one triggered turn." : "";
						return textResult(
							`Watching ${watch.id}: ${sourceLabel(watch)}${SEPARATORS.arrow}${pattern}${wake}\nRead with \`watch matches ${watch.id}\` or \`watch logs ${watch.id}\`.`,
							{ action: "add", watch } satisfies WatchDetails,
						);
					}

					case "list": {
						const watches = runtime.list();
						return textResult(formatWatchList(watches), { action: "list", watches } satisfies WatchDetails);
					}

					case "status": {
						const watch = runtime.get(call.id);
						if (!watch) return errorResult("status", `no watcher "${call.id}".`);
						return textResult(formatWatchStatus(watch), { action: "status", watch } satisfies WatchDetails);
					}

					case "matches": {
						const result = runtime.matches(call.id, call.lines);
						if (!result) return errorResult("matches", `no watcher "${call.id}".`);
						const text = formatTail("matches", result.watch, result.lines, 4000);
						return textResult(text.text, {
							action: "matches",
							watch: result.watch,
							matches: result.lines.join("\n"),
							truncated: text.truncated,
						} satisfies WatchDetails);
					}

					case "logs": {
						const result = runtime.logs(call.id, call.lines);
						if (!result) return errorResult("logs", `no watcher "${call.id}".`);
						const text = formatTail("output", result.watch, result.lines, 4000);
						return textResult(text.text, {
							action: "logs",
							watch: result.watch,
							logs: result.lines.join("\n"),
							truncated: text.truncated,
						} satisfies WatchDetails);
					}

					case "stop": {
						const before = runtime.get(call.id);
						if (!before) return errorResult("stop", `no watcher "${call.id}".`);
						const stopped = runtime.stop(call.id);
						const watch = runtime.get(call.id) ?? before;
						return textResult(
							stopped
								? `Stopped ${watch.id} (${sourceLabel(watch)}).`
								: `${watch.id} was not running; nothing to stop.`,
							{ action: "stop", watch, stopped } satisfies WatchDetails,
						);
					}

					case "clear": {
						const result = runtime.clear(call.id, call.all ?? false);
						if (result.refused) return errorResult("clear", result.refused);
						const watches = runtime.list();
						const cleared =
							result.cleared === 0 ? "" : `Cleared ${result.cleared} watcher${result.cleared === 1 ? "" : "s"}.`;
						// What is still running is the half the reply used to drop: a bare `clear` skipped the
						// running watchers and answered as if the table were empty, and the mixed case answered a
						// satisfied `Cleared 2 watchers.` with a third still going.
						const left = call.all === true ? "" : stillRunning(watches);
						return textResult([cleared, left].filter(Boolean).join(" ") || "Nothing to clear.", {
							action: "clear",
							cleared: result.cleared,
							watches,
						} satisfies WatchDetails);
					}
				}
			} catch (error) {
				return errorResult(call.action, (error as Error).message);
			}
		},

		renderCall(args, theme, context) {
			const action = typeof args.action === "string" ? args.action : "watch";
			const subject = formatCallText(action, args as Record<string, unknown>, context.argsComplete);
			return callLine(theme, context.lastComponent, TOOL_NAME, subject, "middle");
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context.lastComponent);
			const outcome = detailsOrLine(theme, result, options.expanded, toolDetails<WatchDetails>(result.details));
			if ("line" in outcome) {
				text.setText(outcome.line);
				return text;
			}
			const details = outcome.details;

			if (details.action === "list" && details.watches) {
				if (details.watches.length === 0) {
					text.setText(paint(theme, "meta", "No watchers."));
					return text;
				}
				const ordered = [...details.watches].sort(compareWatches);
				const shown = options.expanded ? ordered : ordered.slice(0, RESULT_ROWS);
				const input: WatchResultInput = { kind: "list", watches: shown, more: ordered.length - shown.length };
				const view =
					context.lastComponent instanceof WatchResult ? context.lastComponent : new WatchResult(input, theme);
				view.setInput(input, theme);
				return view;
			}

			if ((details.action === "matches" || details.action === "logs") && details.watch) {
				const raw = (details.action === "matches" ? details.matches : details.logs) ?? "";
				const all = raw === "" ? [] : raw.split("\n");
				const label = details.action === "matches" ? "matches" : "output";
				if (all.length === 0) {
					text.setText(paint(theme, "meta", `No ${label} yet.`));
					return text;
				}
				const shownLines = options.expanded ? all : all.slice(Math.max(0, all.length - RESULT_ROWS));
				const input: WatchResultInput = {
					kind: "lines",
					label,
					lines: shownLines,
					earlier: all.length - shownLines.length,
				};
				const view =
					context.lastComponent instanceof WatchResult ? context.lastComponent : new WatchResult(input, theme);
				view.setInput(input, theme);
				return view;
			}

			if (details.action === "clear") {
				const count = details.cleared ?? 0;
				text.setText(
					paint(
						theme,
						"meta",
						count === 0 ? "Nothing to clear." : `Cleared ${count} watcher${count === 1 ? "" : "s"}.`,
					),
				);
				return text;
			}

			if (details.watch) {
				let line = formatWatchOutcomeLine(details.watch, theme);
				if (details.action === "stop") {
					line += paint(theme, "warn", details.stopped ? " · stopped" : " · already stopped");
				} else if (details.action === "add") {
					const badges: string[] = [];
					if (details.watch.wake) badges.push("wake");
					if (details.watch.fromStart) badges.push("from start");
					if (badges.length > 0) line += paint(theme, "faint", `${SEPARATORS.item}${badges.join(SEPARATORS.item)}`);
				}
				text.setText(line);
				return text;
			}

			text.setText(rejectionLine(theme, result, options.expanded));
			return text;
		},
	});
}
