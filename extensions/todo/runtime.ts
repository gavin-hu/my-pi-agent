/**
 * Session-scoped state and widget synchronization for the todo extension.
 *
 * The list is reconstructed from the active branch on session start and tree
 * navigation, and the persistent widget mirrors it whenever it changes. Only
 * interactive (`tui`) sessions get a widget; the widget's row budget and
 * whether a finished list stays visible come from the todo config.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { announceRailChanged, onRailsSuppressed, onUpperRailChanged } from "../_shared/rails.ts";
import { DEFAULT_TODO_CONFIG, type TodoConfig } from "./config.ts";
import { hasOpenTodos, reconstructTodos } from "./state.ts";
import { TodoWidget, WIDGET_KEY } from "./tui.ts";
import type { Todo } from "./types.ts";

export interface TodoRuntime {
	/** The current list. */
	getTodos(): Todo[];
	/** Replace the list and refresh the widget. */
	setTodos(todos: Todo[], ctx?: ExtensionContext): void;
	/** Rebuild the list from the active branch. */
	reconstruct(ctx: ExtensionContext): void;
	/** Apply the widget config (loaded per session). */
	setConfig(config: TodoConfig): void;
	/** Remove the widget, for example on shutdown. */
	clearWidget(ctx: ExtensionContext): void;
}

export function createTodoRuntime(pi?: Pick<ExtensionAPI, "events">): TodoRuntime {
	let todos: Todo[] = [];
	let config: TodoConfig = DEFAULT_TODO_CONFIG;
	// The most recent interactive context, so the list can re-assert its widget
	// when a rail above it changes. Cleared on shutdown.
	let lastTuiCtx: ExtensionContext | undefined;
	// True while a dock screen owns the editor slot; the rail stays hidden.
	let suppressed = false;

	// An empty list is always hidden; a fully completed one is hidden only when
	// the config asks for it.
	const shouldShow = (): boolean =>
		todos.length > 0 && !(config.hideWhenComplete && !hasOpenTodos(todos));

	const syncWidget = (ctx?: ExtensionContext): void => {
		if (!ctx || ctx.mode !== "tui") return;
		lastTuiCtx = ctx;
		if (suppressed) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		if (!shouldShow()) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			if (pi) announceRailChanged(pi, "todo");
			return;
		}
		const snapshot = todos;
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => new TodoWidget(snapshot, theme));
		// Announce so the jobs rail below re-asserts after this widget was re-inserted.
		if (pi) announceRailChanged(pi, "todo");
	};

	// The goal sits above this list, and the jobs widget below it. Pi re-inserts a
	// widget on every set, so a goal update would sink the list below later rails.
	// Re-assert the list when an upper rail changes: re-insertion appends, pinning
	// the list back under the goal. The list then announces so jobs re-asserts
	// below it in turn.
	if (pi)
		onUpperRailChanged(pi, "todo", () => {
			if (lastTuiCtx) syncWidget(lastTuiCtx);
		});

	// Hide the rail while a dock screen is open; re-sync when the last screen
	// closes so the ordering chain is re-established.
	if (pi)
		onRailsSuppressed(pi, (open) => {
			suppressed = open;
			if (lastTuiCtx) syncWidget(lastTuiCtx);
		});

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
		setConfig: (next) => {
			config = next;
		},
		clearWidget: (ctx) => {
			lastTuiCtx = undefined;
			if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
		},
	};
}
