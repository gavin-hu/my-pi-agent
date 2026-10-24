/**
 * The open streams of one loopback server, and the idle grace that follows the
 * last of them.
 *
 * The response here is a double: what this module owns is the bookkeeping — one
 * release per sink, one grace per empty registry — and a socket only makes the
 * same facts slower to observe. `serve.test.ts` drives it over TCP.
 */

import { describe, expect, test } from "bun:test";
import type { ServerResponse } from "node:http";
import type { ArmTimer } from "../timer.ts";
import { createSinks } from "./sink.ts";

/** A response that records what was written to it, so the sink can own liveness. */
function pageResponse(): ServerResponse & { frames: string[]; ended: boolean } {
	const double = {
		frames: [] as string[],
		ended: false,
		writableEnded: false,
		destroyed: false,
		write(frame: string): boolean {
			double.frames.push(frame);
			return true;
		},
		end(frame?: string): void {
			if (frame !== undefined) double.frames.push(frame);
			double.ended = true;
			double.writableEnded = true;
		},
	};
	// The sink reads only `write`, `end`, `writableEnded`, and `destroyed`, which is
	// everything a route can observe about one response.
	return double as unknown as ServerResponse & { frames: string[]; ended: boolean };
}

/** A grace timer that only fires when the test says so. */
function graceTimer(): { timer: ArmTimer; fire(): void; armed: number; cancelled: number } {
	let pending: (() => void) | undefined;
	const state = {
		armed: 0,
		cancelled: 0,
		timer: ((_ms: number, run: () => void) => {
			state.armed += 1;
			pending = run;
			return () => {
				state.cancelled += 1;
				pending = undefined;
			};
		}) as ArmTimer,
		fire: () => {
			const run = pending;
			pending = undefined;
			run?.();
		},
	};
	return state;
}

describe("event sinks", () => {
	test("writes a frame through, and ends once with the last one", () => {
		const sinks = createSinks();
		const response = pageResponse();
		const sink = sinks.open(response);
		sink.write("data: one\n\n");
		sink.end("data: bye\n\n");
		sink.end("data: again\n\n");
		expect(response.frames).toEqual(["data: one\n\n", "data: bye\n\n"]);
		expect(response.ended).toBe(true);
		expect(sinks.size()).toBe(0);
	});

	test("a write after the end, or to a socket that is gone, is a no-op", () => {
		const sinks = createSinks();
		const ended = pageResponse();
		const sink = sinks.open(ended);
		sink.end();
		sink.write("data: too late\n\n");
		expect(ended.frames).toEqual([]);

		const lost = pageResponse();
		lost.destroyed = true;
		const second = sinks.open(lost);
		second.write("data: nowhere\n\n");
		second.end("data: nowhere\n\n");
		expect(lost.frames).toEqual([]);
		expect(sinks.size()).toBe(0);
	});
});

describe("the idle grace", () => {
	test("is armed when the last stream ends, not before", () => {
		const timer = graceTimer();
		let idled = 0;
		const sinks = createSinks({ idle: { ms: 10, onIdle: () => (idled += 1) }, timer: timer.timer });
		const first = sinks.open(pageResponse());
		const second = sinks.open(pageResponse());
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
		sinks.open(pageResponse()).end();
		expect(timer.armed).toBe(1);
		// A reload or a second tab: the server must not be closed under the page that
		// is still reading it.
		const returning = sinks.open(pageResponse());
		expect(timer.cancelled).toBe(1);
		timer.fire();
		expect(idled).toBe(0);
		returning.end();
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
		sinks.open(pageResponse()).end();
		const open = pageResponse();
		sinks.open(open);
		sinks.endAll();
		expect(open.ended).toBe(true);
		expect(timer.cancelled).toBe(1);
		timer.fire();
		expect(idled).toBe(0);
		expect(sinks.size()).toBe(0);
	});
});
