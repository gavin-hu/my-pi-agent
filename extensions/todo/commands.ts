/**
 * Slash commands for the todo extension.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withRailsSuppressed } from "../_shared/rails.ts";
import { formatTodoList, progressSummary } from "./format.ts";
import type { TodoRuntime } from "./runtime.ts";
import { TodoListComponent } from "./tui.ts";

export function registerCommands(pi: ExtensionAPI, runtime: TodoRuntime): void {
	pi.registerCommand("todos", {
		description: "Show the current todo list",
		handler: async (_args, ctx) => {
			const todos = runtime.getTodos();
			if (ctx.mode !== "tui") {
				ctx.ui.notify(todos.length === 0 ? "No todos." : `${progressSummary(todos)}\n${formatTodoList(todos)}`, "info");
				return;
			}
			let unsubscribe: (() => void) | undefined;
			try {
				await withRailsSuppressed(pi, () =>
					ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
						// Follow the list while the screen is open; the screen is disposed
						// when `done()` resolves `custom`, so unsubscribe afterwards.
						unsubscribe = runtime.onChange(() => tui.requestRender());
						return new TodoListComponent(
							() => runtime.getTodos(),
							theme,
							() => done(),
							() => tui.requestRender(),
							() => tui.terminal?.rows,
						);
					}),
				);
			} finally {
				unsubscribe?.();
			}
		},
	});
}
