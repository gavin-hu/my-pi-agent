/**
 * The `↺ N` status chip for the rewind extension.
 *
 * Shows the number of prompts on the active branch — the same points `/rewind`
 * lists, whether or not each has a code snapshot. Counting the session branch
 * (rather than listing refs) keeps the chip and the menu in lockstep for free.
 * Every call is best-effort: status is never worth failing a session for.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { GLYPHS, STATUS_KEYS } from "../../lib/ui.ts";
import type { RewindConfig } from "./config.ts";
import { userMessagesFromBranch } from "./timeline.ts";

const STATUS_KEY = STATUS_KEYS.rewind;
const STATUS_GLYPH = GLYPHS.rewind;

export interface StatusChip {
	/** Repaint the chip from the prompt count on the active branch. */
	set(ctx: ExtensionContext): Promise<void>;
	/** Remove the chip. */
	clear(ctx: ExtensionContext): void;
}

export interface StatusChipDeps {
	/** Repository (or worktree) root, or undefined outside a repository. */
	rootFor(ctx: ExtensionContext): Promise<string | undefined>;
	configFor(root: string): RewindConfig;
}

export function createStatusChip(deps: StatusChipDeps): StatusChip {
	const set = async (ctx: ExtensionContext): Promise<void> => {
		try {
			const root = await deps.rootFor(ctx);
			if (!root) return;
			if (!deps.configFor(root).showStatus) return;
			const count = userMessagesFromBranch(ctx.sessionManager.getBranch()).length;
			if (count === 0) {
				ctx.ui.setStatus(STATUS_KEY, undefined);
				return;
			}
			// The status bar compacts a two-token icon+count badge (`↺ 2`) to
			// `↺2`, so the count survives a narrow line; `↺` also avoids colliding
			// with the worktree icon `⑂`.
			const label = `${STATUS_GLYPH} ${count}`;
			let themed = label;
			try {
				themed = ctx.ui.theme.fg("accent", label);
			} catch {
				// No initialized theme in a headless run.
			}
			ctx.ui.setStatus(STATUS_KEY, themed);
		} catch {
			// Status is best-effort.
		}
	};

	const clear = (ctx: ExtensionContext): void => {
		try {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		} catch {
			// UI may be unavailable.
		}
	};

	return { set, clear };
}
