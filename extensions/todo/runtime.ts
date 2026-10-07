/**
 * Session-scoped state and widget synchronization for the todo extension.
 *
 * The list is reconstructed from the active branch on session start and tree
 * navigation, and the persistent widget mirrors it whenever it changes. Only
 * interactive (`tui`) sessions get a widget; the tool and `/todos` command work
 * in every mode.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { reconstructTodos } from "./state.ts";
import { TodoWidget, WIDGET_KEY } from "./tui.ts";
import type { Todo } from "./types.ts";

export interface TodoRuntime {
	/** The current list. */
	getTodos(): Todo[];
	/** Replace the list and refresh the widget. */
	setTodos(todos: Todo[], ctx?: ExtensionContext): void;
	/** Rebuild the list from the active branch. */
	reconstruct(ctx: ExtensionContext): void;
	/** Remove the widget, for example on shutdown. */
	clearWidget(ctx: ExtensionContext): void;
}

export function createTodoRuntime(): TodoRuntime {
	let todos: Todo[] = [];

	const syncWidget = (ctx?: ExtensionContext): void => {
		if (!ctx || ctx.mode !== "tui") return;
		if (todos.length === 0) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		const snapshot = todos;
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => new TodoWidget(snapshot, theme));
	};

	return {
		getTodos: () => todos,
		setTodos: (next, ctx) => {
			todos = next;
			syncWidget(ctx);
		},
		reconstruct: (ctx) => {
			todos = reconstructTodos(ctx.sessionManager.getBranch());
			syncWidget(ctx);
		},
		clearWidget: (ctx) => {
			if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
		},
	};
}
