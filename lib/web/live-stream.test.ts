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
	paintLiveState,
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
	/** The page going away, which the browser announces as `pagehide`. */
	hide(): void;
}

/**
 * Boot the shipped source with a stand-in event source, and record what the page would paint.
 *
 * The body is spliced, so this runs the text a bundle gets rather than the module: `globalThis`
 * is the function's parameter, which is how the client's `globalThis.EventSource` is reached.
 */
function boot(options: Partial<LiveStreamOptions> = {}, Source: unknown = FakeStream): Booted {
	// The page's `window`, as far as the client reaches it: every listener it registers, so a
	// case can announce the teardown the browser would.
	const teardown: (() => void)[] = [];
	const globals = {
		EventSource: Source,
		addEventListener: (type: string, listener: () => void) => {
			if (type === "pagehide") teardown.push(listener);
		},
	};
	const bundle = new Function("globalThis", `${CLIENT_RUNTIME_JS}\nreturn { liveStream: liveStream };`)(globals) as {
		liveStream: typeof liveStream;
	};
	const states: LiveState[] = [];
	const frames: StreamEvent[] = [];
	const handle = bundle.liveStream({
		url: "/files/events",
		token: "t",
		words: (state) => states.push(state),
		frame: (event) => frames.push(event),
		...options,
	});
	const stream = FakeStream.last as FakeStream;
	return { states, frames, handle, stream, hide: () => teardown.forEach((listener) => listener()) };
}

describe("the shared live state table", () => {
	// The spliced body, as a page receives it: the table is only shared if it crosses in the bundle.
	test("is one body in the runtime a page carries, safe to splice", () => {
		// A page calls it by name, so a body the assembler dropped would be a first paint that
		// throws with every suite green — the failure #548 fixed.
		expect(CLIENT_RUNTIME_JS.split(String(paintLiveState)).length).toBe(2);
		expect(String(paintLiveState)).not.toContain("`");
		expect(String(paintLiveState)).not.toContain("${");
	});

	const table = new Function(`${CLIENT_RUNTIME_JS}\nreturn { paintLiveState: paintLiveState };`)() as {
		paintLiveState: typeof paintLiveState;
	};

	/** One chip, as far as the painter writes to it. */
	function stateChip() {
		const label = { textContent: "" };
		return { label, node: { className: "", hidden: true, title: "", querySelector: () => label } };
	}

	test("paints the four shared words and their tones, with the retry as a warning", () => {
		// The three pages agreed on the words but not on the retry's tone: the board painted it in
		// the danger the other two keep for a dead stream. One table is what makes that one answer.
		const rows = [
			["connecting", "connecting…", "bf-live bf-tone--accent"],
			["live", "live", "bf-live bf-tone--success"],
			["reconnecting", "reconnecting…", "bf-live bf-tone--warn"],
			["dead", "offline", "bf-live bf-tone--danger"],
		] as const;
		for (const [state, word, tone] of rows) {
			const { node, label } = stateChip();
			table.paintLiveState(node as unknown as Parameters<typeof paintLiveState>[0], state);
			expect(label.textContent, state).toBe(word);
			expect(node.className, state).toBe(tone);
			expect(node.hidden, state).toBe(false);
		}
	});

	test("appends the page's suffix to every word, and hands its tooltip through", () => {
		const board = stateChip();
		table.paintLiveState(board.node as unknown as Parameters<typeof paintLiveState>[0], "live", " · 3m", "Live");
		expect(board.label.textContent).toBe("live · 3m");
		expect(board.node.title).toBe("Live");
		const review = stateChip();
		table.paintLiveState(review.node as unknown as Parameters<typeof paintLiveState>[0], "dead", " · 3 comments");
		expect(review.label.textContent).toBe("offline · 3 comments");
	});
});

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

	test("leaves the query off a page that carries no token", () => {
		// Browse mints none: it answers on the loopback socket only, so its stream names no
		// credential, and a `token=` it cannot check would be the hole rather than the guard.
		const booted = boot({ token: undefined });
		expect(booted.stream.url).toBe("/files/events");
	});

	test("encodes the token rather than splicing it into the query", () => {
		// A page reads its token from its own URL, so the value is the server's, not a promise
		// the client may lean on: `&` and `=` here would otherwise start a second parameter.
		const booted = boot({ token: "a b&c=d" });
		expect(booted.stream.url).toBe("/files/events?token=a%20b%26c%3Dd");
	});

	test("closes its stream when the page goes away", () => {
		// The server watches for the last reader, so a page that leaves without closing holds a
		// mount open for the whole of its idle grace — the one teardown the browser cannot do.
		const booted = boot();
		booted.stream.open();
		booted.hide();
		expect(booted.stream.closed).toBe(true);
		booted.stream.send("message", "late");
		expect(booted.states).toEqual(["live"]);
		expect(booted.frames).toEqual([]);
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
