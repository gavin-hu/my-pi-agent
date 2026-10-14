/**
 * Config-file support for the todo widget.
 *
 * The `todo` section of the shared `bytefly.json` (global then project, project
 * wins). Only the widget
 * presentation is configurable — todo behavior never depends on it.
 */

import { loadConfigSection } from "../../lib/config.ts";

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

/** Effective todo config from the shared `todo` section (defaults, global, project, env). */
export function loadTodoConfig(cwd: string): TodoConfig {
	return loadConfigSection(cwd, "todo", DEFAULT_TODO_CONFIG, normalizeTodoConfig);
}
