/**
 * Slash commands for the todo extension.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
			await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				return new TodoListComponent(todos, theme, () => done(), () => tui.requestRender(), tui.terminal?.rows);
			});
		},
	});
}
