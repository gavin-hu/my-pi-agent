/**
 * The per-job log sink: a write stream, the line splitter that feeds the job's
 * `lastLine`, and rotation when the segment reaches its cap.
 *
 * Extracted from the job runtime so the process/table lifecycle and the log
 * plumbing can be read separately. The writer owns no job state: every path and
 * limit is a callback over the runtime's live config, and a buffered line is
 * handed back through `onLine`.
 *
 * The line splitter is a seam rather than an import: `lib/lines.ts` is loaded with
 * the process seam on the first job, so a session that never starts one never
 * loads it.
 */

import { createWriteStream, existsSync, renameSync, unlinkSync, type WriteStream } from "node:fs";
import type { LineSplitter } from "../../lib/lines.ts";
import type { Job, JobRecord } from "./types.ts";

/** Bytes held while a rotation swaps the log stream before writes resume. */
const MAX_ROTATION_QUEUE_BYTES = 2 * 1024 * 1024;

/** One job's log state: the live segment, the queue, and the counters. */
export interface LogHandle {
	stream?: WriteStream;
	lines: LineSplitter;
	/** Chunks that arrived while the log stream was being swapped. */
	queue: Buffer[];
	/** Bytes currently in `queue`. */
	queuedBytes: number;
	/** True between ending the old stream and reopening the log. */
	rotating: boolean;
	/** Bytes dropped because a rotation could not keep up; reported by `logs`. */
	droppedBytes: number;
	/** Bytes written to the live segment, counted exactly as chunks arrive. */
	logBytes: number;
	/** True once the handle is disposed; a rotation in flight never reopens. */
	disposed: boolean;
}

export interface LogWriterOptions {
	/** The clock the repaint window is measured on. */
	now(): number;
	/**
	 * A fresh line splitter for one job's stream.
	 *
	 * Injected rather than imported: the splitter is the only piece of `lib/lines.ts`
	 * a writer needs, and a runtime that never starts a job must not load it.
	 */
	newSplitter(): LineSplitter;
	/** The live segment for a job, or undefined when it cannot be used. */
	logPath(job: JobRecord): string | undefined;
	/** The rotated segment for a job, or undefined when it cannot be used. */
	rotatedPath(job: JobRecord): string | undefined;
	/** Bytes a segment may reach before it rotates; 0 disables rotation. */
	maxBytes(): number;
	/** The repaint window for output-driven painting. */
	repaintMs(): number;
	/** Record one output line; the runtime sanitizes it onto the job. */
	onLine(job: Job, line: string): void;
	/** Repaint, at most once per repaint window while output arrives. */
	onPaint(): void;
}

export interface LogWriter {
	/** A handle for one job's log; `logPath` is undefined for a detached job. */
	create(logPath: string | undefined): LogHandle;
	/** Append child output, splitting lines and rotating at the cap. */
	write(handle: LogHandle, job: Job, chunk: Buffer): void;
	/** The buffered final lines, including a final line without a newline. */
	flush(handle: LogHandle): string[];
	/** Close the stream and mark the handle dead; idempotent. */
	dispose(handle: LogHandle, options: { endStream: boolean }): void;
}

export function createLogWriter(options: LogWriterOptions): LogWriter {
	/** Last output-driven repaint, so a busy child cannot repaint per chunk. */
	let lastPaint = 0;

	const writeLog = (handle: LogHandle, chunk: Buffer): void => {
		try {
			handle.stream?.write(chunk);
		} catch {
			// A closed stream must not break output handling.
		}
		// Count what we handed the stream: `WriteStream.bytesWritten` only updates on
		// its completion callback, which can lag a tick behind the file on disk.
		if (handle.stream) handle.logBytes += chunk.length;
	};

	/** Buffer a chunk while the log stream is being swapped, dropping the oldest past the cap. */
	const enqueue = (handle: LogHandle, chunk: Buffer, front = false): void => {
		if (front) handle.queue.unshift(chunk);
		else handle.queue.push(chunk);
		handle.queuedBytes += chunk.length;
		while (handle.queuedBytes > MAX_ROTATION_QUEUE_BYTES && handle.queue.length > 1) {
			const dropped = handle.queue.shift();
			if (!dropped) break;
			handle.queuedBytes -= dropped.length;
			handle.droppedBytes += dropped.length;
		}
	};

	/**
	 * Move the live segment aside, queueing `chunk` ahead of the backlog, and reopen.
	 *
	 * Returns false when no rotation can start (no stream, or a record whose log
	 * paths do not validate), so the caller writes the chunk instead of stranding it
	 * in a queue nothing will drain.
	 *
	 * The old stream is ended and its `close` awaited before the rename, because
	 * Windows refuses to rename an open file; chunks that arrive in that window
	 * are queued rather than written, so nothing lands in the renamed inode.
	 */
	const rotateLog = (handle: LogHandle, job: Job, chunk: Buffer): boolean => {
		const stream = handle.stream;
		const logPath = options.logPath(job);
		const rotated = options.rotatedPath(job);
		if (!stream || !logPath || !rotated || handle.rotating) return false;
		// This chunk precedes whatever queued while the previous segment was closing.
		enqueue(handle, chunk, true);
		handle.rotating = true;
		stream.once("close", () => {
			// A killed or cleared job disposes its handle; never reopen for it.
			if (handle.disposed) return;
			try {
				if (existsSync(rotated)) unlinkSync(rotated);
				renameSync(logPath, rotated);
			} catch {
				// A failed rename leaves the oversized segment in place; keep appending.
			}
			const reopened = createWriteStream(logPath, { flags: "a" });
			reopened.on("error", () => {});
			handle.stream = reopened;
			handle.rotating = false;
			handle.logBytes = 0;
			drain(handle, job);
		});
		try {
			stream.end();
		} catch {
			// Already ended.
		}
		return true;
	};

	/** Write one output chunk, rotating the segment first when it reached the cap. */
	const writeChunk = (handle: LogHandle, job: Job, chunk: Buffer): void => {
		if (handle.rotating) {
			// Later than everything already queued.
			enqueue(handle, chunk);
			return;
		}
		const cap = options.maxBytes();
		if (handle.stream && cap > 0 && handle.logBytes >= cap && rotateLog(handle, job, chunk)) return;
		writeLog(handle, chunk);
	};

	/**
	 * Replay the queue through `writeChunk` after a rotation, so a backlog that is
	 * itself larger than the cap rotates again instead of filling one segment.
	 */
	const drain = (handle: LogHandle, job: Job): void => {
		while (!handle.rotating && handle.queue.length > 0) {
			const chunk = handle.queue.shift();
			if (!chunk) break;
			handle.queuedBytes -= chunk.length;
			writeChunk(handle, job, chunk);
		}
	};

	return {
		create(logPath) {
			const stream = logPath === undefined ? undefined : createWriteStream(logPath, { flags: "a" });
			stream?.on("error", () => {});
			return {
				stream,
				lines: options.newSplitter(),
				queue: [],
				queuedBytes: 0,
				rotating: false,
				droppedBytes: 0,
				logBytes: 0,
				disposed: false,
			};
		},

		write(handle, job, chunk) {
			if (handle.disposed) return;
			writeChunk(handle, job, chunk);
			for (const line of handle.lines.push(chunk)) options.onLine(job, line);
			const time = options.now();
			if (time - lastPaint >= options.repaintMs()) {
				lastPaint = time;
				options.onPaint();
			}
		},

		flush(handle) {
			return handle.lines.flush();
		},

		dispose(handle, { endStream }) {
			if (handle.disposed) return;
			handle.disposed = true;
			// A rotation in flight checks `disposed` before reopening, so dropping the
			// queue here cannot leak a stream for a dead job.
			handle.queue = [];
			handle.queuedBytes = 0;
			if (endStream) {
				try {
					handle.stream?.end();
				} catch {
					// Already closed.
				}
			}
			handle.stream = undefined;
		},
	};
}
