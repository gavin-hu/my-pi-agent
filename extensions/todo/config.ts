/**
 * Config-file support for the todo widget.
 *
 * Read from `~/.pi/agent/todo.json` and `<cwd>/.pi/todo.json`; project values
 * override global ones, and missing or malformed files are ignored. Only the
 * widget presentation is configurable — todo behavior never depends on it.
 */

import { loadConfigFile } from "../../lib/config.ts";

export interface TodoConfig {
	/** Hide the widget once every item is completed (an empty list always hides). */
	hideWhenComplete: boolean;
}

export const DEFAULT_TODO_CONFIG: TodoConfig = { hideWhenComplete: true };

/** Validate a raw config object over `base`. */
export function normalizeTodoConfig(raw: Record<string, unknown> | undefined, base: TodoConfig): TodoConfig {
	if (!raw) return base;
	return {
		hideWhenComplete: typeof raw.hideWhenComplete === "boolean" ? raw.hideWhenComplete : base.hideWhenComplete,
	};
}

/** Effective todo config for `cwd` (global file, then project file, over defaults). */
export function loadTodoConfig(cwd: string): TodoConfig {
	return loadConfigFile(cwd, "todo.json", DEFAULT_TODO_CONFIG, normalizeTodoConfig);
}
