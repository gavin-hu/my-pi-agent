/**
 * The todo list the `/todo` widget draws: one completed, one in progress, four open.
 */

import type { Todo } from "../../../extensions/todo/types.ts";

export const TODOS: Todo[] = [
	{ content: "Extract the shared design system into lib/tui", status: "completed" },
	{ content: "Rebuild the bytefly chrome on the kit", status: "completed" },
	{ content: "Migrate the todo, memory, and rewind screens", status: "completed" },
	{
		content: "Migrate the job and watch list screens",
		status: "in_progress",
		activeForm: "Migrating the job and watch screens",
	},
	{ content: "Give the question dialog a height-aware layout", status: "pending" },
	{ content: "Draw the plan review overlay from the kit", status: "pending" },
	{ content: "Refresh the README screenshots", status: "pending" },
];
