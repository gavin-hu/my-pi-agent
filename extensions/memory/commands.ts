/**
 * Slash commands for the memory extension.
 *
 * `/memory` shows the store, `/memory path` prints the two file paths,
 * `/memory edit [scope]` opens the multi-line editor, and `/memory clear
 * [scope]` empties a store after a confirmation. Bulk deletion lives only here,
 * behind a confirm — the model cannot wipe memory in one call.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatNotice, scopeLabel } from "./format.ts";
import type { MemoryRuntime } from "./runtime.ts";
import type { MemoryScope } from "./types.ts";

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function parseScope(raw: string | undefined): MemoryScope {
	return raw?.trim().toLowerCase() === "global" ? "global" : "project";
}

function notify(ctx: ExtensionCommandContext, message: string, kind: "info" | "warning" = "info"): void {
	ctx.ui.notify(message, kind);
}

export function registerCommands(pi: ExtensionAPI, runtime: MemoryRuntime): void {
	pi.registerCommand("memory", {
		description:
			"Show, edit, or clear durable memory: /memory [list | path | edit [project|global] | clear [project|global]]",
		handler: async (args, ctx) => {
			const [sub = "list", scopeArg] = args.trim().split(/\s+/);
			const scope = parseScope(scopeArg);

			switch (sub.toLowerCase()) {
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
					notify(ctx, formatNotice(runtime.entries()));
			}
		},
	});
}
