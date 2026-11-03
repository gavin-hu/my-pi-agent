/**
 * The event streams one loopback server keeps open, the heartbeat that keeps one
 * alive, the reconnect hint its reconnects back off on, and the idle grace that
 * ends a server nobody is reading.
 *
 * The sink is the only thing a route writes: it owns liveness, so a frame after
 * the end is a no-op and `end` twice is fine, and no caller has to ask the raw
 * response whether it is still writable. A route writes what changed, and the sink
 * writes the `: keepalive` comment every {@link KEEPALIVE_MS} on its behalf — a
 * page left open overnight is otherwise dropped as an idle connection somewhere
 * between it and this process, while its chip still says live.
 *
 * The registry is the one place that knows how many are open, which is exactly what
 * an idle policy needs — the last one leaving arms the grace, and a reload
 * re-attaching stands it down — and the one place that sees attempts, which is what
 * a reconnect hint needs: the head's `retry:` doubles per failed connect up to
 * {@link RETRY_MAX_MS}. A stream that got a frame onto the wire resets it, because
 * one that delivered was read, not a server that never answered.
 *
 * Value-only: the only state is what the returned closure carries.
 */

import type { ServerResponse } from "node:http";
import { type ArmTimer, defaultInterval, defaultTimer, type RepeatTimer } from "../timer.ts";
import type { ServeResponse } from "./response.ts";
import { openEventStream } from "./server.ts";

/** How often an open stream says it is still there, in ms. */
export const KEEPALIVE_MS = 20_000;

/** The reconnect hint the first attempt carries, in ms. */
export const RETRY_MS = 2_000;

/** The cap the hint climbs to, so a server that stays down costs minutes, not seconds. */
export const RETRY_MAX_MS = 60_000;

/** The heartbeat itself: a comment frame, which carries no event and no data. */
const KEEPALIVE_FRAME = ": keepalive\n\n";

/** One open event stream, as a route writes it. */
export interface EventSink {
	/** Write one frame; a no-op once the stream has ended. */
	write(frame: string): void;
	/** End the stream, optionally with a last frame; safe to call twice. */
	end(frame?: string): void;
}

/** Why a server went idle: no stream ever opened, or the last one left. */
export type IdleReason = "first" | "last";

/** The idle policy a server was given, or none. */
export interface IdleGrace {
	/** How long the last stream's departure is held, in ms. */
	ms: number;
	/**
	 * How long a server may stand with no stream ever opened, in ms.
	 *
	 * A page opened in a browser that never came up would otherwise hold its port for the
	 * rest of the session. Omitted, the grace still waits for the first stream, which is
	 * what a server whose page is opened by hand wants.
	 */
	firstMs?: number;
	/** Called once no stream has been open for the grace that applied. */
	onIdle: (reason: IdleReason) => void;
}

/** What the registry needs besides the streams themselves. */
export interface SinkDeps {
	/** Grace after the last stream leaves; omitted, the server waits for `endAll`. */
	idle?: IdleGrace;
	/** The timer the grace is armed on; defaults to an unref'd one. */
	timer?: ArmTimer;
	/** The ticker a keepalive is armed on; defaults to an unref'd one. */
	interval?: RepeatTimer;
}

/** The open streams of one loopback server. */
export interface SinkRegistry {
	/**
	 * Write the event-stream head this attempt deserves, and attach a sink over one
	 * response; ending it starts the idle grace.
	 */
	attach(response: ServerResponse, head: Pick<ServeResponse, "status" | "headers">): EventSink;
	/** How many streams are open. */
	size(): number;
	/** Arm the grace for a server nobody may ever read. Does nothing without `firstMs`. */
	start(): void;
	/** End every open stream, because the server is closing. */
	endAll(): void;
}

/**
 * The reconnect hint for the `attempt`th connect in a row: `RETRY_MS`, then doubling,
 * and never past `RETRY_MAX_MS`.
 */
function retryHint(attempt: number): number {
	return Math.min(RETRY_MS * 2 ** Math.max(0, attempt - 1), RETRY_MAX_MS);
}

export function createSinks(deps: SinkDeps = {}): SinkRegistry {
	const streams = new Set<EventSink>();
	const timer = deps.timer ?? defaultTimer;
	const beat = deps.interval ?? defaultInterval;
	let cancelIdle: (() => void) | undefined;
	/** A stream has attached at least once, so a departure is one to wait on. */
	let sawStream = false;
	/** The server asked for the first grace, so it may go idle without a reader. */
	let started = false;
	/** Connects in a row with no frame delivered, which is what the hint climbs on. */
	let attempt = 0;

	const standDown = (): void => {
		cancelIdle?.();
		cancelIdle = undefined;
	};

	/** Arm `ms` from now, unless a stream is open or a grace already runs. */
	const arm = (ms: number, reason: IdleReason): void => {
		if (deps.idle === undefined || (!started && !sawStream) || streams.size > 0 || cancelIdle !== undefined) return;
		cancelIdle = timer(ms, () => {
			cancelIdle = undefined;
			// A tab that attached while the grace ran has already stood it down, but a
			// second look costs nothing and keeps a race from closing a page being read.
			if (streams.size === 0) deps.idle?.onIdle(reason);
		});
	};

	return {
		attach(response, head) {
			standDown();
			sawStream = true;
			// A second tab on a mount that is already being read is not a reconnect, so it
			// neither climbs the ladder nor takes a bigger hint than the first one got.
			if (streams.size === 0) attempt += 1;
			openEventStream(response, head, retryHint(attempt));
			const sink = createSink(response, beat, (delivered) => {
				if (delivered) attempt = 0;
				if (!streams.delete(sink)) return;
				const idle = deps.idle;
				if (idle !== undefined) arm(idle.ms, "last");
			});
			streams.add(sink);
			return sink;
		},
		size: () => streams.size,
		start() {
			const idle = deps.idle;
			if (idle?.firstMs === undefined || started || sawStream) return;
			started = true;
			arm(idle.firstMs, "first");
		},
		endAll() {
			standDown();
			const open = [...streams];
			streams.clear();
			for (const sink of open) sink.end();
		},
	};
}

/**
 * A sink over one response, released from its registry exactly once.
 *
 * `delivered` is the difference between a stream that was read and one that never
 * answered, which is the only thing the reconnect hint needs to know: a heartbeat
 * counts, since a comment frame that reached the wire proves the same connection.
 */
function createSink(response: ServerResponse, beat: RepeatTimer, released: (delivered: boolean) => void): EventSink {
	let ended = false;
	let delivered = false;
	const write = (frame: string): void => {
		if (ended || response.writableEnded || response.destroyed) return;
		delivered = true;
		response.write(frame);
	};
	const stopBeat = beat(KEEPALIVE_MS, () => write(KEEPALIVE_FRAME));
	return {
		write,
		end(frame) {
			if (ended) return;
			ended = true;
			stopBeat();
			if (!response.writableEnded && !response.destroyed) {
				if (frame === undefined) response.end();
				else response.end(frame);
			}
			released(delivered);
		},
	};
}
