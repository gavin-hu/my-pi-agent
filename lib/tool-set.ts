/**
 * The active tool set one mode narrows and puts back.
 *
 * A mode hides the tools its policy does not allow and keeps its own verbs, then
 * leaves exactly the set the user had — not the wider one the mode needed, and not
 * a tool another extension had already hidden. Plan mode wrote that surgery inline;
 * lead mode needs the same bookkeeping over its own policy and its own verbs, so it
 * lives here once.
 *
 * Value-only: the tools a mode had to *activate* are this factory's own closure,
 * never a module variable, so two modes in one process cannot see each other's
 * memory — and the tools a mode *hid* are the caller's, because the session entry
 * carries them and a resumed branch has to restore them with no factory present.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ReadOnlyPolicy } from "./policy.ts";

/** The two calls a mode makes on the host's active set. */
export type ToolSetHost = Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">;

/** What leaving a mode may do with the tools it hid. */
export interface LeaveOptions {
	/**
	 * Re-activate the tools the mode hid. A user leaving passes `true`; a branch
	 * restore passes `false`, because the host has already put the target branch's
	 * base set back and re-adding would widen it.
	 */
	reAdd?: boolean;
}

/** The filter one mode applies to the active set. */
export interface ToolSetFilter {
	/** The tools this mode would hide, as the active set stands now. */
	capture(): string[];
	/** Narrow the active set to what the policy allows plus the mode's own tools. */
	enter(): void;
	/** Put the user's own set back, re-adding `removed` unless told not to. */
	leave(removed: readonly string[], options?: LeaveOptions): void;
}

/**
 * Build the filter for one mode.
 *
 * `capture` is the caller's to persist: the hidden list travels on the session
 * entry so a disable can put those tools back and a `/tree` restore can adopt the
 * list the branch it lands on recorded. `enter` remembers what it had to activate,
 * and `leave` drops exactly those again, so a mode that needed a tool for a while
 * does not leave it behind.
 */
export function createToolSetFilter(
	host: ToolSetHost,
	policy: Pick<ReadOnlyPolicy, "isAllowed">,
	modeTools: readonly string[],
): ToolSetFilter {
	/** Tools this enable had to activate, so leaving puts the user's set back. */
	let added: string[] = [];

	return {
		capture: () => [
			...new Set(host.getActiveTools().filter((name) => !policy.isAllowed(name) && !modeTools.includes(name))),
		],
		enter: () => {
			const active = host.getActiveTools();
			added = modeTools.filter((name) => !active.includes(name));
			host.setActiveTools([...new Set([...active.filter((name) => policy.isAllowed(name)), ...modeTools])]);
		},
		leave: (removed, options = {}) => {
			const kept = host.getActiveTools().filter((name) => !added.includes(name));
			added = [];
			const restored = options.reAdd === false ? [] : removed;
			host.setActiveTools([...new Set([...kept, ...restored])]);
		},
	};
}
