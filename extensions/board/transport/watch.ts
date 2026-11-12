/**
 * The board's pile, watched: one platform seam for "something under this directory
 * changed", and the timer that folds the burst a single write arrives in.
 *
 * A card is a file, so a change is a filesystem event and not a state that has to be
 * polled for. The page used to scan the whole store once a second; with a watch the scan
 * happens when a file moves, and the five-second sweep in `server.ts` keeps only the facts
 * no file announces.
 *
 * The seam reads *that* something moved, never *what*: `FSEvents` coalesces, `inotify` is
 * immediate, and `ReadDirectoryChangesW` reports the file name, so a shared contract built
 * on the name would be a contract about one platform. One directory event is a request to
 * read the board, and the board's signature decides whether that read is news.
 *
 * Value-only at the module level: no watcher is opened until a caller asks for one, so the
 * page's factory stays registration and the sweep starts in `session_start`.
 */

import { type FSWatcher, watch } from "node:fs";
import { type ArmTimer, defaultTimer } from "../../../lib/timer.ts";

/**
 * How long the first event's window stays open.
 *
 * A write is a temp file, a rename, and sometimes an unlink — three events for one change.
 * The window is fixed rather than restarted by each event, so a bulk write cannot keep
 * pushing the push out: the page reads once per window while it lasts.
 */
export const COALESCE_MS = 100;

/** A running watch: closing it stops the signal and any window already armed. */
export interface WatchHandle {
	/** Close the watchers; idempotent, like every other close in `lib/http`. */
	stop(): void;
}

/** What a caller may hand the seam instead of the production defaults. */
export interface WatchOptions {
	/** The one-shot seam the coalescing window is armed on, so a case fires it. */
	timer?: ArmTimer;
}

/**
 * Watch every directory in `dirs`, calling `onChange` once per burst.
 *
 * `undefined` when not one directory could be watched — a caller keeps its own cadence
 * then, rather than waiting on a signal that will never arrive. A directory that disappears
 * under a running page only ends its own watcher: the sweep is what keeps the page alive.
 */
export type WatchDirs = (
	dirs: readonly string[],
	onChange: () => void,
	options?: WatchOptions,
) => WatchHandle | undefined;

/** Open one directory, or `undefined` when it cannot be opened. */
function openWatcher(dir: string, onEvent: () => void): FSWatcher | undefined {
	try {
		// Not persistent: a page nobody is reading must not be the reason a process stays up.
		const watcher = watch(dir, { persistent: false }, onEvent);
		// A directory removed under a running page ends its own signal, and the sweep covers
		// the rest. Raising it here would be an error thrown into a process nobody awaits.
		watcher.on("error", () => {});
		return watcher;
	} catch {
		return undefined;
	}
}

/** The production seam: `fs.watch` per directory, folded by one window per burst. */
export const defaultWatchDirs: WatchDirs = (dirs, onChange, options = {}) => {
	const arm = options.timer ?? defaultTimer;
	const watchers: FSWatcher[] = [];
	let armed: (() => void) | undefined;
	let stopped = false;

	// The first event opens the window; the events behind it join it, which is what makes a
	// write's rename and unlink one change rather than three.
	const onEvent = (): void => {
		if (stopped || armed !== undefined) return;
		armed = arm(COALESCE_MS, () => {
			armed = undefined;
			if (!stopped) onChange();
		});
	};

	for (const dir of dirs) {
		const watcher = openWatcher(dir, onEvent);
		if (watcher !== undefined) watchers.push(watcher);
	}
	if (watchers.length === 0) return undefined;

	return {
		stop(): void {
			if (stopped) return;
			stopped = true;
			// A window already armed would otherwise fire into a page that has closed.
			armed?.();
			armed = undefined;
			for (const watcher of watchers) watcher.close();
			watchers.length = 0;
		},
	};
};
