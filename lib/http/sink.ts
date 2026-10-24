/**
 * The event streams one loopback server keeps open, and the idle grace that ends
 * a server nobody is reading.
 *
 * The sink is the only thing a route writes: it owns liveness, so a frame after
 * the end is a no-op and `end` twice is fine, and no caller has to ask the raw
 * response whether it is still writable. The registry is the one place that knows
 * how many are open, which is exactly what an idle policy needs — the last one
 * leaving arms the grace, and a reload re-attaching stands it down.
 *
 * Value-only: the only state is what the returned closure carries.
 */

import type { ServerResponse } from "node:http";
import { type ArmTimer, defaultTimer } from "../timer.ts";

/** One open event stream, as a route writes it. */
export interface EventSink {
	/** Write one frame; a no-op once the stream has ended. */
	write(frame: string): void;
	/** End the stream, optionally with a last frame; safe to call twice. */
	end(frame?: string): void;
}

/** The idle policy a server was given, or none. */
export interface IdleGrace {
	/** How long the last stream's departure is held, in ms. */
	ms: number;
	/** Called once no stream has been open for `ms`. */
	onIdle: () => void;
}

/** What the registry needs besides the streams themselves. */
export interface SinkDeps {
	/** Grace after the last stream leaves; omitted, the server waits for `endAll`. */
	idle?: IdleGrace;
	/** The timer the grace is armed on; defaults to an unref'd one. */
	timer?: ArmTimer;
}

/** The open streams of one loopback server. */
export interface SinkRegistry {
	/** Open a sink over one response; ending it starts the idle grace. */
	open(response: ServerResponse): EventSink;
	/** How many streams are open. */
	size(): number;
	/** End every open stream, because the server is closing. */
	endAll(): void;
}

export function createSinks(deps: SinkDeps = {}): SinkRegistry {
	const streams = new Set<EventSink>();
	const timer = deps.timer ?? defaultTimer;
	let cancelIdle: (() => void) | undefined;
	/** A grace armed before any page ever attached would close a server nobody opened. */
	let sawStream = false;

	const standDown = (): void => {
		cancelIdle?.();
		cancelIdle = undefined;
	};

	const arm = (): void => {
		const idle = deps.idle;
		if (idle === undefined || !sawStream || streams.size > 0 || cancelIdle !== undefined) return;
		cancelIdle = timer(idle.ms, () => {
			cancelIdle = undefined;
			if (streams.size === 0) deps.idle?.onIdle();
		});
	};

	return {
		open(response) {
			standDown();
			sawStream = true;
			const sink = createSink(response, () => {
				if (streams.delete(sink)) arm();
			});
			streams.add(sink);
			return sink;
		},
		size: () => streams.size,
		endAll() {
			standDown();
			const open = [...streams];
			streams.clear();
			for (const sink of open) sink.end();
		},
	};
}

/** A sink over one response, released from its registry exactly once. */
function createSink(response: ServerResponse, release: () => void): EventSink {
	let ended = false;
	return {
		write(frame) {
			if (ended || response.writableEnded || response.destroyed) return;
			response.write(frame);
		},
		end(frame) {
			if (ended) return;
			ended = true;
			if (!response.writableEnded && !response.destroyed) {
				if (frame === undefined) response.end();
				else response.end(frame);
			}
			release();
		},
	};
}
