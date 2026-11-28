/**
 * What one watcher keeps: its matched lines, and the raw output tail, both bounded.
 *
 * `maxLogLines` came first and bounded the count, which left the size open — a line reaches
 * 1 MiB, so 500 of them is a gigabyte per watcher, and the table allows twenty. Both bounds live
 * here so neither can be tightened without the other.
 *
 * The byte bound holds whole lines, with one exception stated as the rule: the newest line is
 * kept even when it alone is over budget. A tail that emptied itself to stay under a byte count
 * would read as a broken watcher rather than as a bound that held, so the watch page says the
 * bound is on the tail and not on a single line.
 *
 * The matches carry their own sequence numbers, because a read mark names one: the notice path
 * asks for what is unread, marks what it reported, and the watcher notifies again once the list
 * is clear. Keeping that beside the buffer is what makes one object the whole answer to "what
 * does this watcher still hold".
 */

import type { WatchConfig } from "./config.ts";
import type { WatchMatch } from "./types.ts";

/** The newest entries of a tail, and whether anything older was dropped. */
export interface Tail {
	lines: string[];
	truncated: boolean;
}

export interface Retention {
	/** Keep one raw line, dropping the oldest once either bound is passed. */
	push(line: string): void;
	/** Keep one match; the sequence number is assigned here so a read mark can name it. */
	keep(line: string, at: number): void;
	/** The newest `count` raw lines, oldest first. */
	raw(count: number): Tail;
	/** The newest `count` matched lines, oldest first. */
	matches(count: number): Tail;
	/** The matches nobody has read yet, oldest first. */
	unread(): WatchMatch[];
	/** Mark the matches with these sequence numbers read. */
	markSeen(seqs: ReadonlySet<number>): void;
	/** Whether every kept match has been read, so the next one notifies again. */
	allSeen(): boolean;
}

/** The newest `count` entries of `all`, and whether the front was cut to get there. */
function window(all: readonly string[], count: number): Tail {
	const start = Math.max(0, all.length - count);
	return { lines: all.slice(start), truncated: start > 0 };
}

export function createRetention(config: WatchConfig): Retention {
	const raw: string[] = [];
	const matched: WatchMatch[] = [];
	let seq = 0;
	let bytes = 0;
	// Counted rather than derived from `raw`, because both bounds drop lines: a reader is told
	// there is more to the log whether the count or the size is what left it out.
	let dropped = 0;

	const drop = (): void => {
		const oldest = raw.shift();
		if (oldest === undefined) return;
		bytes -= Buffer.byteLength(oldest, "utf8");
		dropped += 1;
	};

	return {
		push(line: string): void {
			raw.push(line);
			// Counted in UTF-8 bytes, which is the memory a line actually holds: `String.length`
			// is UTF-16 units, and a bound measured in those would be a wish for a non-ASCII log.
			bytes += Buffer.byteLength(line, "utf8");
			while (raw.length > config.maxLogLines) drop();
			while (bytes > config.maxLogBytes && raw.length > 1) drop();
		},
		keep(line: string, at: number): void {
			matched.push({ seq: ++seq, line, at, seen: false });
			if (matched.length > config.maxMatches) matched.splice(0, matched.length - config.maxMatches);
		},
		raw(count: number): Tail {
			const tailed = window(raw, count);
			return { lines: tailed.lines, truncated: tailed.truncated || dropped > 0 };
		},
		matches(count: number): Tail {
			return window(
				matched.map((match) => match.line),
				count,
			);
		},
		unread(): WatchMatch[] {
			return matched.filter((match) => !match.seen);
		},
		markSeen(seqs: ReadonlySet<number>): void {
			for (const match of matched) if (seqs.has(match.seq)) match.seen = true;
		},
		allSeen(): boolean {
			return matched.every((match) => match.seen);
		},
	};
}
