/**
 * Config-file support for the todo widget.
 *
 * Read from `~/.pi/agent/todo.json` and `<cwd>/.pi/todo.json`; project values
 * override global ones, and missing or malformed files are ignored. Only the
 * widget presentation is configurable — todo behavior never depends on it.
 */

import { clampInteger, loadConfigFile } from "../_shared/config.ts";
import { DEFAULT_MAX_ROWS } from "./types.ts";

export interface TodoConfig {
	/** Total widget rows, including the header and any overflow row. */
	maxRows: number;
	/** Hide the widget once every item is completed (an empty list always hides). */
	hideWhenComplete: boolean;
}

export const DEFAULT_TODO_CONFIG: TodoConfig = { maxRows: DEFAULT_MAX_ROWS, hideWhenComplete: true };

/** Smallest/largest widget row budget that still shows at least one item. */
export const MIN_MAX_ROWS = 3;
export const MAX_MAX_ROWS = 10;

/** Validate/clamp a raw config object over `base`. */
export function normalizeTodoConfig(raw: Record<string, unknown> | undefined, base: TodoConfig): TodoConfig {
	if (!raw) return base;
	return {
		maxRows: clampInteger(raw.maxRows, base.maxRows, MIN_MAX_ROWS, MAX_MAX_ROWS),
		hideWhenComplete: typeof raw.hideWhenComplete === "boolean" ? raw.hideWhenComplete : base.hideWhenComplete,
	};
}

/** Effective todo config for `cwd` (global file, then project file, over defaults). */
export function loadTodoConfig(cwd: string): TodoConfig {
	return loadConfigFile(cwd, "todo.json", DEFAULT_TODO_CONFIG, normalizeTodoConfig);
}
