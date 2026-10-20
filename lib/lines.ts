/**
 * Line splitting for a stream of untrusted output.
 *
 * A child's stdout, or a file read, arrives in arbitrary byte chunks: a chunk
 * boundary can fall in the middle of a line, and — the case a naive
 * `chunk.toString()` gets wrong — in the middle of a multi-byte UTF-8
 * character. This buffers the bytes and decodes only at a newline, so a split
 * character survives intact.
 *
 * `\r` is not treated as a break: a progress rewrite belongs to the sanitizer
 * (`sanitizeUntrustedLine` in `lib/format.ts`, which keeps the text after the
 * last carriage return), and breaking on it here would turn one rewritten line
 * into several.
 *
 * Value-only: the buffer lives on the instance, so each reader owns one.
 */

/** Bytes buffered for one incomplete line before it is emitted anyway. */
export const MAX_LINE_BYTES = 1024 * 1024;

export interface LineSplitterOptions {
	/** Emit an unfinished line once it grows past this many bytes. Default 1 MiB. */
	maxLineBytes?: number;
}

export class LineSplitter {
	private pending: Buffer = Buffer.alloc(0);
	private readonly maxLineBytes: number;

	constructor(options: LineSplitterOptions = {}) {
		this.maxLineBytes = options.maxLineBytes ?? MAX_LINE_BYTES;
	}

	/** Bytes held for the unfinished line. */
	get pendingBytes(): number {
		return this.pending.length;
	}

	/**
	 * Feed one chunk and take every complete line it finishes.
	 *
	 * A line far longer than any display can show is emitted once it reaches the
	 * cap instead of being dropped, so a program that never prints a newline still
	 * produces output.
	 */
	push(chunk: Uint8Array | string): string[] {
		const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
		const combined = this.pending.length > 0 ? Buffer.concat([this.pending, bytes]) : bytes;
		const lines: string[] = [];
		let start = 0;
		for (let newline = combined.indexOf(0x0a); newline >= 0; newline = combined.indexOf(0x0a, start)) {
			lines.push(combined.subarray(start, newline).toString("utf8"));
			start = newline + 1;
		}
		let rest = combined.subarray(start);
		if (rest.length > this.maxLineBytes) {
			lines.push(rest.toString("utf8"));
			rest = combined.subarray(0, 0);
		}
		// Copy, so a caller that reuses its read buffer cannot rewrite the tail.
		this.pending = Buffer.from(rest);
		return lines;
	}

	/** Take the unfinished line, for a stream that has ended. */
	flush(): string[] {
		if (this.pending.length === 0) return [];
		const line = this.pending.toString("utf8");
		this.pending = Buffer.alloc(0);
		return [line];
	}

	/** Drop the unfinished line, for a source that was truncated or replaced. */
	reset(): void {
		this.pending = Buffer.alloc(0);
	}
}
