/**
 * Bounded, sanitized reading of a job's log file.
 *
 * Logs are append-only and can grow without limit, so a `logs` call reads only a
 * byte tail and then the requested number of lines. Everything surfaced is
 * sanitized (see `format.ts`); the file itself is never modified.
 */

import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { sanitizeLogText, tailLines } from "./format.ts";

/** Bytes of log read for a `logs` call. */
const LOG_READ_BYTES = 64 * 1024;

/** Drop trailing blank lines so a final newline does not eat a requested line. */
function dropTrailingBlank(lines: string[]): string[] {
	const copy = [...lines];
	while (copy.length > 0 && copy[copy.length - 1] === "") copy.pop();
	return copy;
}

export interface LogTail {
	/** Sanitized tail lines, newest last. */
	lines: string[];
	/** True when the file was longer than the byte window. */
	truncated: boolean;
	/** True when earlier lines exist beyond the returned window. */
	more: boolean;
}

/** Read a bounded, sanitized tail of `path`; a missing/unreadable file is empty. */
export function readLogTail(path: string | undefined, lines: number): LogTail {
	let text = "";
	let truncated = false;
	let start = 0;
	try {
		if (path && existsSync(path)) {
			const size = statSync(path).size;
			start = Math.max(0, size - LOG_READ_BYTES);
			truncated = start > 0;
			const fd = openSync(path, "r");
			try {
				const buffer = Buffer.alloc(size - start);
				readSync(fd, buffer, 0, buffer.length, start);
				text = buffer.toString("utf8");
			} finally {
				closeSync(fd);
			}
		}
	} catch {
		// A missing/unreadable log yields an empty tail.
	}
	const all = dropTrailingBlank(sanitizeLogText(text));
	const more = start > 0 || all.length > lines;
	return { lines: tailLines(all, lines), truncated, more };
}
