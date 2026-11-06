/**
 * The inbound media directory's retention sweep.
 *
 * Every file a peer sends is written under `media/` and read by the turn that
 * answers it, so a bridge left running for weeks would keep every photo and file
 * forever. This is what takes them away: one pass at a bridge start, then the same
 * pass every {@link MEDIA_SWEEP_MS} while the connection lives. Age decides, not a
 * count — a turn may still hold the path of the message it is answering, and that
 * file was written seconds ago.
 *
 * The deletion rule itself is `pruneMedia` in `transport/media.ts`; this module is
 * the clock around it, and the one line the terminal reads when something went.
 */

import { pruneMedia } from "../transport/media.ts";
import { defaultInterval, type RepeatTimer } from "../../../lib/timer.ts";

/** How often a running bridge looks again: often enough that a day of photos cannot pile up. */
export const MEDIA_SWEEP_MS = 6 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What one sweep needs; every value is read at call time. */
export interface MediaSweepDeps {
	/** The directory inbound files are saved in. */
	mediaDir: () => string;
	/** The window in days; `0` keeps every file. */
	retentionDays: () => number;
	now: () => number;
	/** Say what went, on the terminal. Silent when a sweep took nothing. */
	notify?: (line: string) => void;
	/** The repeating timer; injected so a test ticks it instead of waiting. */
	interval?: RepeatTimer;
}

/** The sweep a connection runs, and its one tick. */
export interface MediaSweep {
	/** Sweep now, then keep sweeping until {@link MediaSweep.stop}. */
	start(): void;
	/** End the tick; a sweep in flight is not interrupted. */
	stop(): void;
}

export function createMediaSweep(deps: MediaSweepDeps): MediaSweep {
	let cancel: (() => void) | undefined;

	/** One pass, reported when it removed something. */
	function sweep(): void {
		const days = deps.retentionDays();
		const pruned = pruneMedia(deps.mediaDir(), days * DAY_MS, deps.now());
		if (pruned === 0) return;
		const files = pruned === 1 ? "file" : "files";
		const window = days === 1 ? "1 day" : `${days} days`;
		deps.notify?.(`Pruned ${pruned} WeChat media ${files} older than ${window}.`);
	}

	return {
		start(): void {
			if (cancel) return;
			sweep();
			cancel = (deps.interval ?? defaultInterval)(MEDIA_SWEEP_MS, sweep);
		},
		stop(): void {
			cancel?.();
			cancel = undefined;
		},
	};
}
