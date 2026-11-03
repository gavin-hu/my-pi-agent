/**
 * The live-stream client: the one state machine the three served pages follow.
 *
 * The three pages used to answer "the stream errored" in three ways — forever reconnecting,
 * offline on the first blip, and a review that kept its settled state — so this suite holds
 * the transitions themselves, over a stand-in for the browser's `EventSource` that it drives
 * by hand. What a state *says* is each page's own, and its suite holds that half.
 *
 * Held apart from `web.test.ts`, which is at its size bar.
 */

import { describe, expect, test } from "bun:test";
import {
	CLIENT_RUNTIME_JS,
	type LiveState,
	type StreamEvent,
	type LiveStreamOptions,
	liveStream,
} from "./client-runtime.ts";

/** One stand-in for the browser's event source: every listener, and every way to drive it. */
class FakeStream {
	/** The last one constructed, so a case can drive the stream the client opened. */
	static last: FakeStream | undefined;
	onopen: ((event: StreamEvent) => void) | null = null;
	onerror: ((event: StreamEvent) => void) | null = null;
	onmessage: ((event: StreamEvent) => void) | null = null;
	readonly listeners = new Map<string, ((event: StreamEvent) => void)[]>();
	closed = false;

	constructor(readonly url: string) {
		FakeStream.last = this;
	}

	addEventListener(name: string, listener: (event: StreamEvent) => void): void {
		this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
	}

	close(): void {
		this.closed = true;
	}

	/** The connection came up. */
	open(): void {
		this.onopen?.({ type: "open" });
	}

	/** A frame arrived: the default `message`, or one of the page's named ones. */
	send(type: string, data = ""): void {
		const event: StreamEvent = { type, data };
		if (type === "message") this.onmessage?.(event);
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}

	/** A failed connect or reconnect attempt, `times` of them. */
	fail(times = 1): void {
		for (let i = 0; i < times; i += 1) this.onerror?.({ type: "error" });
	}
}

/** What one booted stream recorded about itself. */
interface Booted {
	states: LiveState[];
	frames: StreamEvent[];
	handle: { close(): void };
	stream: FakeStream;
}

/**
 * Boot the shipped source with a stand-in event source, and record what the page would paint.
 *
 * The body is spliced, so this runs the text a bundle gets rather than the module: `globalThis`
 * is the function's parameter, which is how the client's `globalThis.EventSource` is reached.
 */
function boot(options: Partial<LiveStreamOptions> = {}, Source: unknown = FakeStream): Booted {
	const globals = { EventSource: Source };
	const bundle = new Function("globalThis", `${CLIENT_RUNTIME_JS}\nreturn { liveStream: liveStream };`)(globals) as {
		liveStream: typeof liveStream;
	};
	const states: LiveState[] = [];
	const frames: StreamEvent[] = [];
	const handle = bundle.liveStream({
		url: "/files/events?token=t",
		words: (state) => states.push(state),
		frame: (event) => frames.push(event),
		...options,
	});
	const stream = FakeStream.last as FakeStream;
	return { states, frames, handle, stream };
}

describe("the live-stream client", () => {
	test("opens the URL it was handed, and paints nothing before the stream moves", () => {
		// The server draws the chip's first state into the document, so the client's first paint
		// is a transition it observed: an immediate `connecting` would be a second opinion.
		const booted = boot();
		expect(booted.stream.url).toBe("/files/events?token=t");
		expect(booted.states).toEqual([]);
		booted.stream.open();
		expect(booted.states).toEqual(["live"]);
	});

	test("is live as soon as a frame arrives, and paints the transition once", () => {
		// A frame proves the connection whether or not the open event reached the page first.
		const booted = boot();
		booted.stream.send("message", "one");
		booted.stream.send("message", "two");
		expect(booted.states).toEqual(["live"]);
		expect(booted.frames.map((event) => event.data)).toEqual(["one", "two"]);
	});

	test("says reconnecting while the browser retries, and dead once the attempts run out", () => {
		// A drop is a blip until the retries say otherwise: the page is stale, not wrong, while
		// the browser is still asking, and only a stream that did not come back offers a reload.
		const booted = boot({ attempts: 3 });
		booted.stream.open();
		booted.stream.fail();
		expect(booted.states).toEqual(["live", "reconnecting"]);
		booted.stream.fail();
		expect(booted.states).toEqual(["live", "reconnecting"]);
		booted.stream.fail();
		expect(booted.states).toEqual(["live", "reconnecting", "dead"]);
	});

	test("keeps a stream that never opened at connecting through the blip, then calls it dead", () => {
		const booted = boot({ attempts: 2 });
		booted.stream.fail();
		expect(booted.states).toEqual([]);
		booted.stream.fail();
		expect(booted.states).toEqual(["dead"]);
	});

	test("is live again when a dead stream comes back, with the count reset", () => {
		const booted = boot({ attempts: 2 });
		booted.stream.open();
		booted.stream.fail(2);
		expect(booted.states).toEqual(["live", "reconnecting", "dead"]);
		booted.stream.open();
		expect(booted.states).toEqual(["live", "reconnecting", "dead", "live"]);
		// The retries start again from zero: one more failure is a blip, not a death.
		booted.stream.fail();
		expect(booted.states.at(-1)).toBe("reconnecting");
	});

	test("hands over the named frames a page asked for, beside the default message", () => {
		const booted = boot({ events: ["status", "moved"] });
		booted.stream.send("status", "snapshot");
		booted.stream.send("moved", "/tmp/other");
		booted.stream.send("message", "kind");
		expect(booted.frames.map((event) => event.type)).toEqual(["status", "moved", "message"]);
	});

	test("stops at close: the socket is released and a late event paints nothing", () => {
		const booted = boot();
		booted.stream.open();
		booted.handle.close();
		expect(booted.stream.closed).toBe(true);
		booted.stream.open();
		booted.stream.send("message", "late");
		booted.stream.fail(5);
		expect(booted.states).toEqual(["live"]);
		expect(booted.frames).toEqual([]);
	});

	test("leaves a page with no event source alone, and still answers close", () => {
		// The server's own markup is the whole page then, which is the same rule the browse
		// client states for JavaScript off: nothing painted that the page cannot keep true.
		const booted = boot({}, undefined);
		expect(booted.states).toEqual([]);
		expect(() => booted.handle.close()).not.toThrow();
	});

	test("calls a stream it cannot open dead, rather than throwing in the page's boot", () => {
		const Source = function Unopenable(): never {
			throw new Error("no such URL");
		};
		const booted = boot({}, Source);
		expect(booted.states).toEqual(["dead"]);
		expect(() => booted.handle.close()).not.toThrow();
	});

	test("carries one body, safe to splice", () => {
		// The bundle is a template literal: a backtick or an interpolation would end the script,
		// and the failure would be a page that never paints a state.
		expect(CLIENT_RUNTIME_JS.split(String(liveStream)).length).toBe(2);
		expect(String(liveStream)).not.toContain("`");
		expect(String(liveStream)).not.toContain("${");
	});
});
