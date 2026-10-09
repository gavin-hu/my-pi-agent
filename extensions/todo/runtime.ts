/**
 * Session-scoped state, lag tracking, and widget synchronization for the todo
 * extension.
 *
 * The list is reconstructed from the active branch on session start and tree
 * navigation, and the persistent widget mirrors it whenever it changes. Only
 * interactive (`tui`) sessions get a widget; the widget's row budget and
 * whether a finished list stays visible come from the todo config. The same
 * runtime carries the lag-tracking flags the `agent_before_settle` reminder
 * reads, so they reset with the session and the branch.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { onRailsSuppressed, onUpperRailChanged } from "../../lib/rails.ts";
import { DEFAULT_TODO_CONFIG, type TodoConfig } from "./config.ts";
import { shouldNudge } from "./nudge.ts";
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
	/** Record that a mutating tool ran since the last update. */
	noteWork(): void;
	/** Whether a lag reminder is due and has not been sent for it yet. */
	nudgeDue(): boolean;
	/** Mark the current lag as reminded, activating the injected reminder. */
	markNudged(): void;
	/** Expire the injected reminder at the start of a new user turn. */
	deactivateNudge(): void;
	/** Whether an injected reminder is still current. */
	isNudgeActive(): boolean;
	/** Clear per-turn lag tracking; the reminder itself expires separately. */
	resetNudge(): void;
	/** Subscribe to list changes; returns an unsubscribe. */
	onChange(listener: () => void): () => void;
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
	// Lag tracking: `dirty` is set when a mutating tool runs and cleared by a
	// todo update, `nudged` caps the reminder to one per user turn, and
	// `nudgeActive` marks an injected reminder as current so `context` keeps it
	// for the continuation and drops it on the next user turn.
	let dirty = false;
	let nudged = false;
	let nudgeActive = false;
	// Screens watching the list (for example the open `/todos` screen) so they
	// can re-render when the list changes underneath them.
	const listeners = new Set<() => void>();
	const notify = (): void => {
		for (const listener of listeners) listener();
	};

	// An empty list is always hidden; a fully completed one is hidden only when
	// the config asks for it.
	const shouldShow = (): boolean => todos.length > 0 && !(config.hideWhenComplete && !hasOpenTodos(todos));

	const syncWidget = (ctx?: ExtensionContext): void => {
		if (!ctx || ctx.mode !== "tui") return;
		lastTuiCtx = ctx;
		if (suppressed || !shouldShow()) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		const snapshot = todos;
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => new TodoWidget(snapshot, theme));
	};

	// Re-assert the list when the goal above it changes: Pi re-inserts a widget
	// on every set, so a goal update would otherwise sink the list below it. Todo
	// is the bottom rail, so it does not announce.
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
			// A todo update is the model syncing the list, so the lag is cleared.
			// `nudged` is not: the reminder stays capped at one per user turn.
			dirty = false;
			syncWidget(ctx);
			notify();
		},
		reconstruct: (ctx) => {
			todos = reconstructTodos(ctx.sessionManager.getBranch());
			dirty = false;
			nudged = false;
			nudgeActive = false;
			syncWidget(ctx);
			notify();
		},
		setConfig: (next) => {
			config = next;
		},
		noteWork: () => {
			dirty = true;
		},
		nudgeDue: () => shouldNudge(dirty, nudged, todos),
		markNudged: () => {
			nudged = true;
			nudgeActive = true;
		},
		deactivateNudge: () => {
			nudgeActive = false;
		},
		isNudgeActive: () => nudgeActive,
		resetNudge: () => {
			dirty = false;
			nudged = false;
		},
		onChange: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		clearWidget: (ctx) => {
			lastTuiCtx = undefined;
			if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
		},
	};
}
