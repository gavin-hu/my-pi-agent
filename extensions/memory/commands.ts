/**
 * Slash commands for the memory extension.
 *
 * A bare `/memory` opens the interactive picker in the TUI and prints the list
 * elsewhere; `/memory list` always prints. `/memory path` prints the two file
 * paths, `/memory reload` re-reads the stores, `/memory edit [scope]` opens the
 * multi-line editor, and `/memory clear [scope]` empties a store after a
 * confirmation. Bulk deletion lives only in the command, behind a confirm — the
 * model cannot wipe memory in one call.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { withRailsSuppressed } from "../../lib/rails.ts";
import { messageOf } from "./errors.ts";
import { formatNotice, scopeLabel } from "./format.ts";
import type { MemoryRuntime } from "./runtime.ts";
import { MemoryPickerComponent } from "./tui.ts";
import { MEMORY_SCOPES, type MemoryScope } from "./types.ts";

/** How often the open picker re-checks the stores for an external edit. */
const PICKER_POLL_MS = 1000;

function parseScope(raw: string | undefined): MemoryScope {
	const value = raw?.trim().toLowerCase();
	return MEMORY_SCOPES.find((scope) => scope === value) ?? "project";
}

function notify(ctx: ExtensionCommandContext, message: string, kind: "info" | "warning" = "info"): void {
	ctx.ui.notify(message, kind);
}

/** `/memory` subcommands and the scope argument accepted by `edit`/`clear`. */
const MEMORY_SUBCOMMANDS = ["list", "path", "reload", "edit", "clear"];

/** Usage line shared by the command description and the unknown-subcommand warning. */
const MEMORY_USAGE = "/memory [list | path | reload | edit [project|global] | clear [project|global]]";

/** Subcommand on the first token, scope on the second for `edit`/`clear`. */
function completeMemoryArg(prefix: string): Array<{ value: string; label: string }> | null {
	const [sub = "", argument] = prefix.trimStart().split(/\s+/);
	if (argument !== undefined) {
		if (sub !== "edit" && sub !== "clear") return null;
		const scopes = MEMORY_SCOPES.filter((scope) => scope.startsWith(argument));
		return scopes.length > 0 ? scopes.map((value) => ({ value, label: value })) : null;
	}
	const items = MEMORY_SUBCOMMANDS.filter((option) => option.startsWith(sub));
	return items.length > 0 ? items.map((value) => ({ value: `${value} `, label: value })) : null;
}

/** Bare `/memory`: the picker in the TUI, the plain listing everywhere else. */
async function openPicker(pi: ExtensionAPI, runtime: MemoryRuntime, ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.mode !== "tui") {
		notify(ctx, formatNotice(runtime.entries()));
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
				const component = new MemoryPickerComponent(
					tui,
					theme,
					{
						entries: () => runtime.entries(),
						trusted: () => runtime.trusted(),
						refresh: () => runtime.refresh().changed.length > 0,
						add: (scope, text) => runtime.add(scope, text),
						update: (scope, from, to) => runtime.update(scope, from, to),
						forget: (scope, entry) => runtime.forget(scope, entry),
					},
					() => {
						stopTimer();
						done();
					},
					() => tui.requestRender(),
					() => tui.terminal?.rows,
				);

				// Pick up an external edit while the screen is open, repainting only on a change.
				timer = setInterval(() => {
					if (runtime.refresh().changed.length > 0) tui.requestRender();
				}, PICKER_POLL_MS);
				timer.unref?.();

				return component;
			}),
		);
	} finally {
		stopTimer();
	}
}

export function registerCommands(pi: ExtensionAPI, runtime: MemoryRuntime): void {
	pi.registerCommand("memory", {
		description: `Show or manage durable memory: ${MEMORY_USAGE}`,
		getArgumentCompletions: completeMemoryArg,
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			// A bare `/memory` opens the picker; an explicit subcommand keeps its text form.
			if (trimmed === "") {
				await openPicker(pi, runtime, ctx);
				return;
			}
			const [sub = "list", scopeArg] = trimmed.split(/\s+/);
			const scope = parseScope(scopeArg);

			switch (sub.toLowerCase()) {
				case "list": {
					notify(ctx, formatNotice(runtime.entries()));
					return;
				}
				case "path": {
					const paths = runtime.paths();
					if (!paths) {
						notify(ctx, "Memory is not initialized yet.");
						return;
					}
					const trust = runtime.trusted() ? "trusted" : "untrusted (read-only)";
					notify(ctx, `Project: ${paths.project} [${trust}]\nGlobal:  ${paths.global}`);
					return;
				}
				case "reload": {
					const result = runtime.refresh();
					if (result.warning) {
						notify(ctx, `Memory reloaded with a problem: ${result.warning}`, "warning");
						return;
					}
					notify(
						ctx,
						result.changed.length > 0
							? `Reloaded ${result.changed.map(scopeLabel).join(", ")} memory.`
							: "Memory is already up to date.",
					);
					return;
				}
				case "edit": {
					if (!ctx.hasUI) {
						notify(ctx, "Editing memory requires an interactive session.", "warning");
						return;
					}
					if (scope === "project" && !runtime.trusted()) {
						notify(ctx, "Project memory is unavailable for an untrusted project.", "warning");
						return;
					}
					try {
						const edited = await ctx.ui.editor(`Edit ${scope} memory`, runtime.raw(scope));
						if (edited === undefined) return;
						await runtime.write(scope, edited.endsWith("\n") ? edited : `${edited}\n`);
						notify(ctx, `Saved ${scope} memory (${runtime.entries()[scope].length} notes).`);
					} catch (error) {
						notify(ctx, `Memory not saved: ${messageOf(error)}`, "warning");
					}
					return;
				}
				case "clear": {
					if (!ctx.hasUI) {
						notify(ctx, "Clearing memory requires an interactive session.", "warning");
						return;
					}
					try {
						const count = runtime.entries()[scope].length;
						if (count === 0) {
							notify(ctx, `No ${scopeLabel(scope)} memory to clear.`);
							return;
						}
						const approved = await ctx.ui.confirm(
							`Clear ${scopeLabel(scope)} memory?`,
							`Remove all ${count} ${scopeLabel(scope)} notes? This cannot be undone.`,
						);
						if (!approved) return;
						await runtime.clear(scope);
						notify(ctx, `Cleared ${scopeLabel(scope)} memory.`);
					} catch (error) {
						notify(ctx, `Memory not cleared: ${messageOf(error)}`, "warning");
					}
					return;
				}
				default:
					notify(ctx, `Unknown /memory subcommand. Use ${MEMORY_USAGE}.`, "warning");
			}
		},
	});
}
