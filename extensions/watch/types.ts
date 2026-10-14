/**
 * Shared types for the watch extension.
 *
 * A watcher tails a file or a command's merged output, matches each new line
 * against a regular expression (minus an exclude list), and keeps a bounded
 * history of matches and raw lines. Watchers are session-only: they live in the
 * runtime closure and are stopped on session shutdown.
 */

export const WATCH_ACTIONS = ["add", "list", "status", "matches", "logs", "stop", "clear"] as const;
export type WatchAction = (typeof WATCH_ACTIONS)[number];

export const WATCH_STATUSES = ["running", "stopped", "exited", "error"] as const;
export type WatchStatus = (typeof WATCH_STATUSES)[number];

export type WatchSourceKind = "file" | "command";

/** Where a watcher reads lines from. Exactly one of `path`/`command` is set. */
export interface WatchSource {
	kind: WatchSourceKind;
	/** Absolute path, for a file source. */
	path?: string;
	/** Shell command, for a command source. */
	command?: string;
	/** Working directory, for a command source. */
	cwd?: string;
}

/** One line that matched, sanitized for storage and display. */
export interface WatchMatch {
	/** Monotonic per-watcher sequence number, used to mark a match reported. */
	seq: number;
	line: string;
	at: number;
	seen: boolean;
}

/** Public, serializable state for one watcher (tool-result `details`). */
export interface WatchRecord {
	id: string;
	label: string;
	source: WatchSource;
	pattern: string;
	exclude: string[];
	caseSensitive: boolean;
	wake: boolean;
	fromStart: boolean;
	status: WatchStatus;
	startedAt: number;
	endedAt?: number;
	error?: string;
	linesRead: number;
	matchCount: number;
	lastMatchAt?: number;
	/** Command source only. */
	pid?: number;
	exitCode?: number | null;
	signal?: string | null;
}

/** A match that has not been reported to the model yet. */
export interface PendingMatch {
	watcherId: string;
	label: string;
	seq: number;
	line: string;
	at: number;
}

/** The `details` shape carried by every `watch` tool result. */
export interface WatchDetails {
	action: WatchAction;
	watch?: WatchRecord;
	watches?: WatchRecord[];
	/** Sanitized matched lines, newline-joined. */
	matches?: string;
	/** Sanitized raw tail, newline-joined. */
	logs?: string;
	truncated?: boolean;
	stopped?: boolean;
	cleared?: number;
	error?: string;
}
