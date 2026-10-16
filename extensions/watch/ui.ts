/**
 * Presentation for the watch extension: the footer status chips and the match
 * alert.
 *
 * Kept separate from the runtime so the runtime owns lifecycle (the watcher
 * table, the tail clock) and this owns "how watchers are shown". The chips come
 * from the shared `lib/tui/status-controller.ts`, so only the vocabulary — the
 * keys, glyphs, and counts — is watch-specific.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { createStatusController, type StatusChip, type StatusController } from "../../lib/tui/status-controller.ts";
import type { WatchConfig } from "./config.ts";
import { shortLabel } from "./format.ts";
import type { WatchRecord } from "./types.ts";

export interface UiController extends StatusController {
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
	// The match alert also needs the context, so it is mirrored here.
	let ctx: ExtensionContext | undefined;

	const controller = createStatusController({
		keys: [STATUS_KEYS.watch, STATUS_KEYS.watchMatches],
		enabled: () => getConfig().showStatus,
		chips: (): StatusChip[] => {
			let running = 0;
			for (const watch of getWatches()) if (watch.status === "running") running++;
			return [
				{ key: STATUS_KEYS.watch, glyph: GLYPHS.target, count: running, role: "accent" },
				{ key: STATUS_KEYS.watchMatches, glyph: GLYPHS.warn, count: getUnseenMatches(), role: "bad" },
			];
		},
	});

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
			controller.attach(next);
		},
		detach: () => {
			ctx = undefined;
			controller.detach();
		},
		paint: () => {
			controller.paint();
		},
		setStatus: (next) => {
			if (next) ctx = next;
			controller.setStatus(next);
		},
		notifyMatch,
	};
}
