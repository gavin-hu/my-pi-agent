/**
 * The notes the `/memory` picker lists, project scope first, and the callbacks it needs.
 */

import type { MemoryEntries } from "../../../extensions/memory/format.ts";
import type { MemoryPickerCallbacks } from "../../../extensions/memory/tui.ts";

/** Notes the `/memory` picker lists, project scope first. */
export const MEMORY_ENTRIES: MemoryEntries = {
	project: [
		"Run bun run check before every commit",
		"Worktrees live in .pi/worktrees; one per task",
		"Stage explicit paths; never git add -A",
	],
	global: ["Prefer rg over grep for searches", "Ask before publishing a release"],
};

/**
 * The picker's store double: reads the fixture and refuses every write, so a
 * capture can never add, move, or forget a note in the real store.
 */
export const MEMORY_CALLBACKS: MemoryPickerCallbacks = {
	entries: () => MEMORY_ENTRIES,
	trusted: () => true,
	refresh: () => false,
	add: async () => ({ changed: false }),
	update: async () => false,
	forget: async () => false,
	merge: async () => false,
	move: async () => ({ moved: false }),
};
