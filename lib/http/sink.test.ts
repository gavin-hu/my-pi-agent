/**
 * The open streams of one loopback server, the heartbeat each one writes, the
 * reconnect hint its attempts climb on, and the idle grace that follows the last
 * of them.
 *
 * The response here is a double: what this module owns is the bookkeeping — one
 * release per sink, one grace per empty registry, one ticker per stream, and one
 * hint per attempt — and a socket only makes the same facts slower to observe.
 * `serve.test.ts` drives it over TCP.
 */

import { describe, expect, test } from "bun:test";
import { graceTimer } from "../../test/helpers/fixtures/http.ts";
import type { ServerResponse } from "node:http";
import type { RepeatTimer } from "../timer.ts";
import { createSinks, KEEPALIVE_MS, MAX_BUFFERED_BYTES, RETRY_MAX_MS, RETRY_MS } from "./sink.ts";

/** The head a case opens a stream with: status and headers the double ignores. */
const HEAD = { status: 200, headers: {} };

/** A response that records what was written to it, so the sink can own liveness. */
function pageResponse(): ServerResponse & { frames: string[]; ended: boolean; stall(bytes: number): void } {
	const double = {
		frames: [] as string[],
		ended: false,
		// A socket nobody has stalled: the backlog the bound is asked about, and the close a drop
		// makes. Declared rather than omitted, so no case rests on a field the cast invented.
		writableLength: 0,
		writableEnded: false,
		destroyed: false,
		/** How far behind this socket has fallen, which is the one fact a stalled peer has. */
		stall(bytes: number): void {
			double.writableLength = bytes;
		},
		writeHead(): void {},
		write(frame: string): boolean {
			double.frames.push(frame);
			return true;
		},
		end(frame?: string): void {
			if (frame !== undefined) double.frames.push(frame);
			double.ended = true;
			double.writableEnded = true;
		},
		destroy(): void {
			double.destroyed = true;
		},
	};
	// The sink reads only `write`, `end`, `writableLength`, `writableEnded`, and `destroyed`, which is
	// everything a route can observe about one response; the head write reaches the rest of the
	// response through the same double.
	return double as unknown as ServerResponse & { frames: string[]; ended: boolean; stall(bytes: number): void };
}

/** The reconnect hint one stream's head carried, which is the first frame written to it. */
function retryOf(response: { frames: string[] }): number {
	const found = /^retry: (\d+)\n\n$/.exec(response.frames[0] ?? "");
	if (found === null) throw new Error(`no retry hint in ${JSON.stringify(response.frames[0])}`);
	return Number(found[1]);
}

/**
 * The keepalive's own seam: a ticker that runs only when a case fires it, and
 * records the period it was asked for and how many times it was stopped.
 */
function beatTicker(): { interval: RepeatTimer; periods: number[]; stops: number; tick(): void } {
	let pending: (() => void) | undefined;
	const state = {
		periods: [] as number[],
		stops: 0,
		interval: ((ms: number, run: () => void) => {
			state.periods.push(ms);
			pending = run;
			return () => {
				state.stops += 1;
				pending = undefined;
			};
		}) as RepeatTimer,
		tick: () => pending?.(),
	};
	return state;
}

describe("event sinks", () => {
	test("writes a frame through, and ends once with the last one", () => {
		const sinks = createSinks({ interval: beatTicker().interval });
		const response = pageResponse();
		const sink = sinks.attach(response, HEAD);
		sink.write("data: one\n\n");
		sink.end("data: bye\n\n");
		sink.end("data: again\n\n");
		expect(response.frames.slice(1)).toEqual(["data: one\n\n", "data: bye\n\n"]);
		expect(response.ended).toBe(true);
		expect(sinks.size()).toBe(0);
	});

	test("a write after the end, or to a socket that is gone, is a no-op", () => {
		const sinks = createSinks({ interval: beatTicker().interval });
		const ended = pageResponse();
		const sink = sinks.attach(ended, HEAD);
		sink.end();
		sink.write("data: too late\n\n");
		expect(ended.frames).toEqual([`retry: ${RETRY_MS}\n\n`]);

		const lost = pageResponse();
		lost.destroyed = true;
		const second = sinks.attach(lost, HEAD);
		second.write("data: nowhere\n\n");
		second.end("data: nowhere\n\n");
		// The head is the server's answer to a request that did arrive; no frame of the stream
		// follows it once the socket is gone.
		expect(lost.frames.slice(1)).toEqual([]);
		expect(sinks.size()).toBe(0);
	});
});

describe("a socket that stopped reading", () => {
	test("is destroyed at the bound, and the frame that trips it is never written", () => {
		const beat = beatTicker();
		const timer = graceTimer();
		let idled = 0;
		const sinks = createSinks({
			interval: beat.interval,
			idle: { ms: 10, onIdle: () => (idled += 1) },
			timer: timer.timer,
		});
		const response = pageResponse();
		const sink = sinks.attach(response, HEAD);
		sink.write("data: one\n\n");
		// The backlog the socket failed to take, as a paused peer leaves it.
		response.stall(MAX_BUFFERED_BYTES + 1);
		sink.write("data: two\n\n");
		// Destroyed, not ended: an `end`ed backlog stays for the life of the process, which is the
		// memory this bound exists to give back.
		expect(response.destroyed).toBe(true);
		expect(response.ended).toBe(false);
		expect(response.frames.slice(1)).toEqual(["data: one\n\n"]);
		expect(sinks.size()).toBe(0);
		// Released once, and the last stream leaving arms the grace like any other departure.
		sink.end();
		expect(beat.stops).toBe(1);
		expect(timer.armed).toBe(1);
		timer.fire();
		expect(idled).toBe(1);
	});

	test("is kept while it is behind but still reading", () => {
		const sinks = createSinks({ interval: beatTicker().interval });
		const response = pageResponse();
		const sink = sinks.attach(response, HEAD);
		for (let frame = 0; frame < 5; frame += 1) {
			// At the bound, never past it: the socket is slow, which is not the same as stopped.
			response.stall(MAX_BUFFERED_BYTES);
			sink.write(`data: ${frame}\n\n`);
		}
		expect(response.destroyed).toBe(false);
		expect(response.frames).toHaveLength(6);
		expect(sinks.size()).toBe(1);
	});
});

describe("the keepalive", () => {
	test("writes a comment frame on its own ticker, and stops at the end", () => {
		const beat = beatTicker();
		const sinks = createSinks({ interval: beat.interval });
		const response = pageResponse();
		const sink = sinks.attach(response, HEAD);
		// One ticker per stream, at the one period the policy names.
		expect(beat.periods).toEqual([KEEPALIVE_MS]);
		expect(KEEPALIVE_MS).toBe(20_000);
		beat.tick();
		// A comment, not an event: it carries no name and no data, so a page reads nothing from
		// it, and the stream is still open behind it.
		expect(response.frames).toEqual([`retry: ${RETRY_MS}\n\n`, ": keepalive\n\n"]);
		expect(response.ended).toBe(false);
		sink.end();
		expect(beat.stops).toBe(1);
		beat.tick();
		expect(response.frames).toHaveLength(2);
	});
});

describe("the reconnect hint", () => {
	test("is the base hint on the first connect, then doubling to the cap", () => {
		const beat = beatTicker();
		const sinks = createSinks({ interval: beat.interval });
		const hints: number[] = [];
		for (let attempt = 0; attempt < 8; attempt += 1) {
			const response = pageResponse();
			sinks.attach(response, HEAD).end();
			hints.push(retryOf(response));
		}
		// A server that stays down costs a connection a minute, not one every two seconds per
		// tab overnight; the eighth attempt is not a bigger number than the seventh.
		expect(hints).toEqual([
			RETRY_MS,
			RETRY_MS * 2,
			RETRY_MS * 4,
			RETRY_MS * 8,
			RETRY_MS * 16,
			RETRY_MAX_MS,
			RETRY_MAX_MS,
			RETRY_MAX_MS,
		]);
		expect(RETRY_MAX_MS).toBe(60_000);
	});

	test("resets once a stream delivered a frame, a keepalive included", () => {
		const beat = beatTicker();
		const sinks = createSinks({ interval: beat.interval });
		sinks.attach(pageResponse(), HEAD).end();
		// A second attempt with nothing delivered climbs, and the frame it wrote is what
		// says the connection was read rather than a server that never answered.
		const spoke = pageResponse();
		const talking = sinks.attach(spoke, HEAD);
		expect(retryOf(spoke)).toBe(RETRY_MS * 2);
		talking.write("data: one\n\n");
		talking.end();
		const afterTalk = pageResponse();
		sinks.attach(afterTalk, HEAD).end();
		expect(retryOf(afterTalk)).toBe(RETRY_MS);
		// A heartbeat proves the same thing, so a page with nothing to say does not climb
		// either.
		const beatOnly = pageResponse();
		const beating = sinks.attach(beatOnly, HEAD);
		expect(retryOf(beatOnly)).toBe(RETRY_MS * 2);
		beat.tick();
		beating.end();
		const afterBeat = pageResponse();
		sinks.attach(afterBeat, HEAD).end();
		expect(retryOf(afterBeat)).toBe(RETRY_MS);
	});

	test("does not climb for a second tab on a mount that is already being read", () => {
		const beat = beatTicker();
		const sinks = createSinks({ interval: beat.interval });
		const first = pageResponse();
		sinks.attach(first, HEAD);
		const second = pageResponse();
		sinks.attach(second, HEAD);
		// Two tabs are one attempt: the hint is what a tab's browser waits, and opening a
		// second one is not a reconnect.
		expect(retryOf(first)).toBe(RETRY_MS);
		expect(retryOf(second)).toBe(RETRY_MS);
	});
});

describe("the idle grace", () => {
	test("is armed when the last stream ends, not before", () => {
		const timer = graceTimer();
		let idled = 0;
		const sinks = createSinks({ idle: { ms: 10, onIdle: () => (idled += 1) }, timer: timer.timer });
		const first = sinks.attach(pageResponse(), HEAD);
		const second = sinks.attach(pageResponse(), HEAD);
		expect(timer.armed).toBe(0);
		first.end();
		expect(timer.armed).toBe(0);
		second.end();
		expect(timer.armed).toBe(1);
		expect(idled).toBe(0);
		timer.fire();
		expect(idled).toBe(1);
	});

	test("a client that comes back stands it down", () => {
		const timer = graceTimer();
		let idled = 0;
		const sinks = createSinks({ idle: { ms: 10, onIdle: () => (idled += 1) }, timer: timer.timer });
		sinks.attach(pageResponse(), HEAD).end();
		expect(timer.armed).toBe(1);
		// A reload or a second tab: the server must not be closed under the page that
		// is still reading it.
		const returning = sinks.attach(pageResponse(), HEAD);
		expect(timer.cancelled).toBe(1);
		timer.fire();
		expect(idled).toBe(0);
		returning.end();
	});

	test("arms a first grace when the server asks, before any page attached", () => {
		const timer = graceTimer();
		const reasons: string[] = [];
		const sinks = createSinks({
			idle: { ms: 10, firstMs: 20, onIdle: (reason) => reasons.push(reason) },
			timer: timer.timer,
		});
		// A server is bound and nobody has opened it: without this the port would be held
		// for the whole session by a browser that never came up.
		sinks.start();
		expect(timer.armed).toBe(1);
		timer.fire();
		expect(reasons).toEqual(["first"]);
	});

	test("stands the first grace down when a tab finally attaches", () => {
		const timer = graceTimer();
		const reasons: string[] = [];
		const sinks = createSinks({
			idle: { ms: 10, firstMs: 20, onIdle: (reason) => reasons.push(reason) },
			timer: timer.timer,
		});
		sinks.start();
		const sink = sinks.attach(pageResponse(), HEAD);
		expect(timer.cancelled).toBe(1);
		timer.fire();
		expect(reasons).toEqual([]);
		sink.end();
		timer.fire();
		expect(reasons).toEqual(["last"]);
	});

	test("asks for no first grace when the caller named none", () => {
		const timer = graceTimer();
		const sinks = createSinks({ idle: { ms: 10, onIdle: () => {} }, timer: timer.timer });
		sinks.start();
		expect(timer.armed).toBe(0);
	});

	test("never arms before a page has ever attached", () => {
		const timer = graceTimer();
		const sinks = createSinks({ idle: { ms: 10, onIdle: () => {} }, timer: timer.timer });
		sinks.endAll();
		expect(timer.armed).toBe(0);
	});

	test("ending every stream with the server stands it down", () => {
		const timer = graceTimer();
		let idled = 0;
		const sinks = createSinks({ idle: { ms: 10, onIdle: () => (idled += 1) }, timer: timer.timer });
		sinks.attach(pageResponse(), HEAD).end();
		const open = pageResponse();
		sinks.attach(open, HEAD);
		sinks.endAll();
		expect(open.ended).toBe(true);
		expect(timer.cancelled).toBe(1);
		timer.fire();
		expect(idled).toBe(0);
		expect(sinks.size()).toBe(0);
	});
});
