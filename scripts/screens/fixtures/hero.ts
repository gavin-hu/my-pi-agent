/**
 * The rails the hero capture draws above its footer (dev tooling).
 *
 * Hand-written for the hero rather than borrowed from `./todo.ts`, whose list is
 * the `lib/tui` migration and would show finished work in the picture. One goal
 * and the three items it takes to reach it, so the rail reads as current work:
 * the board page is done, the screenshots are being refreshed.
 */

import type { Goal } from "../../../extensions/goal/types.ts";
import type { Todo } from "../../../extensions/todo/types.ts";

/** The top rail: the objective the frame is shipping. */
export const HERO_GOAL: Goal = { objective: "Ship the board page in 0.19.0", status: "active" };

/** The bottom rail: one completed item, the current one, and what follows. */
export const HERO_TODOS: Todo[] = [
	{ content: "Land the board page", status: "completed" },
	{ content: "Refresh the screenshots", status: "in_progress", activeForm: "Refreshing the screenshots" },
	{ content: "Cut 0.19.0", status: "pending" },
];
