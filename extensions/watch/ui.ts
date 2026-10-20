/**
 * Presentation for the watch extension: the footer status chips and the match
 * alert.
 *
 * The chips and the context they paint through come from the shared
 * `lib/tui/status-controller.ts`, so only the vocabulary — the keys, glyphs,
 * counts, and message text — is watch-specific.
 */

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
		controller.notify(`watch ${watch.id} (${shortLabel(watch)}) matched: ${line}`, "warning");
	};

	return { ...controller, notifyMatch };
}
