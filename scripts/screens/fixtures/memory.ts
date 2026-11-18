/**
 * The notes the `/memory` picker lists, project scope first, and the callbacks it needs.
 */

import type { MemoryEntries } from "../../../extensions/memory/format.ts";
import type { MemoryPickerCallbacks } from "../../../extensions/memory/view/memory-picker.ts";

/** Notes the `/memory` picker lists, project scope first. */
export const MEMORY_ENTRIES: MemoryEntries = {
	project: [
		{ text: "Run bun run check before every commit" },
		{ text: "Worktrees live in .pi/worktrees; one per task" },
		{ text: "Stage explicit paths; never git add -A" },
	],
	global: [{ text: "Prefer rg over grep for searches" }, { text: "Ask before publishing a release" }],
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
