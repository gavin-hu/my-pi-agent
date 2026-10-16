/**
 * Presentation for the watch extension: the footer status chips and the match
 * alert.
 *
 * Kept separate from the runtime so the runtime owns lifecycle (the watcher
 * table, the tail clock) and this owns "how watchers are shown". It holds only
 * the last context it was attached to; every method no-ops if nothing is
 * attached or the UI is unavailable in the current mode.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import type { WatchConfig } from "./config.ts";
import { shortLabel } from "./format.ts";
import type { WatchRecord } from "./types.ts";

export interface UiController {
	/** Remember the live context; later calls use it when no context is passed. */
	attach(ctx: ExtensionContext): void;
	/** Forget the context, for example on shutdown or reload. */
	detach(): void;
	/** Repaint the chips using the attached context. */
	paint(): void;
	/** Publish the footer chips (and attach `ctx` when given). */
	setStatus(ctx?: ExtensionContext): void;
	/** Alert the user to a new match; called once per unreported burst. */
	notifyMatch(watch: WatchRecord, line: string): void;
}

export interface UiOptions {
	getWatches(): Iterable<WatchRecord>;
	getUnseenMatches(): number;
	getConfig(): WatchConfig;
}

export function createUiController(options: UiOptions): UiController {
	const { getWatches, getUnseenMatches, getConfig } = options;
	let ctx: ExtensionContext | undefined;

	const theme = (target: ExtensionContext, color: "accent" | "error", text: string): string => {
		try {
			return target.ui.theme.fg(color, text);
		} catch {
			return text;
		}
	};

	const setStatus = (next?: ExtensionContext): void => {
		if (next) ctx = next;
		const target = ctx;
		if (!target) return;
		try {
			if (!getConfig().showStatus) {
				target.ui.setStatus(STATUS_KEYS.watch, undefined);
				target.ui.setStatus(STATUS_KEYS.watchMatches, undefined);
				return;
			}
			let running = 0;
			for (const watch of getWatches()) if (watch.status === "running") running++;
			const unseen = getUnseenMatches();
			target.ui.setStatus(
				STATUS_KEYS.watch,
				running > 0 ? theme(target, "accent", `${GLYPHS.target} ${running}`) : undefined,
			);
			target.ui.setStatus(
				STATUS_KEYS.watchMatches,
				unseen > 0 ? theme(target, "error", `${GLYPHS.warn} ${unseen}`) : undefined,
			);
		} catch {
			// UI may be unavailable in non-interactive modes.
		}
	};

	const notifyMatch = (watch: WatchRecord, line: string): void => {
		const target = ctx;
		if (!target) return;
		try {
			target.ui.notify(`watch ${watch.id} (${shortLabel(watch)}) matched: ${line}`, "warning");
		} catch {
			// UI may be unavailable in non-interactive modes.
		}
	};

	return {
		attach: (next) => {
			ctx = next;
		},
		detach: () => {
			ctx = undefined;
		},
		paint: () => {
			setStatus();
		},
		setStatus,
		notifyMatch,
	};
}
