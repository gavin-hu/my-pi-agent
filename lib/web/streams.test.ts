/**
 * The kit's server-side event streams: who is listening, what they are told, and the closed-tab
 * grace a page may ask for.
 *
 * The registry lived in `extensions/plan/web-streams.ts` until every consumer had to reach into
 * plan for it; the plan's own cases still drive a real review over a socket (`web-stream.test.ts`),
 * so what was missing was the other half — unit cases over a hand-driven timer and a recording
 * sink. Those are the four grace scenarios the plan's browser suites already assert (a reload
 * inside the grace is not a departure, a page that is not the lifetime arms nothing, a reconnect
 * leaves the grace pending, a settled page is silent), reproduced here without a socket.
 *
 * Held apart from `web.test.ts`, which is at its size bar, and beside `live-stream.test.ts`, which
 * holds the client half of the same idea.
 */

import { describe, expect, test } from "bun:test";
import type { EventSink } from "../http/index.ts";
import { graceTimer } from "../../test/helpers/fixtures/http.ts";
import { createStreams, type StreamRegistry } from "./streams.ts";

/** A page: the frames it was sent, the frames it was ended with, and how often it was closed. */
function page(): { sink: EventSink; frames: string[]; ended: string[]; closed: { count: number } } {
	const frames: string[] = [];
	const ended: string[] = [];
	const closed = { count: 0 };
	return {
		frames,
		ended,
		closed,
		sink: {
			write: (frame) => {
				frames.push(frame);
			},
			end: (frame) => {
				closed.count += 1;
				if (frame !== undefined) ended.push(frame);
			},
		},
	};
}

/** A review-shaped registry: the owner page is the lifetime, with a grace a case fires by hand. */
function review(): { streams: StreamRegistry; timer: ReturnType<typeof graceTimer>; abandoned: number[] } {
	const timer = graceTimer();
	const abandoned: number[] = [];
	const streams = createStreams({
		lifetime: (record) => record.key === "owner",
		onAbandoned: () => abandoned.push(1),
		graceMs: 5_000,
		schedule: timer.timer,
		settled: () => false,
	});
	return { streams, timer, abandoned };
}

describe("the stream registry", () => {
	test("tells every open page, and only the ones a filter names", () => {
		const { streams } = review();
		const owner = page();
		const reader = page();
		streams.add(owner.sink, { key: "owner" });
		streams.add(reader.sink, { key: "reviewer", token: "r1" });

		streams.broadcast("comment");
		expect(owner.frames).toEqual(["data: comment\n\n"]);
		expect(reader.frames).toEqual(["data: comment\n\n"]);

		streams.broadcast("comment", { key: "owner" });
		expect(owner.frames).toHaveLength(2);
		expect(reader.frames).toHaveLength(1);

		streams.broadcast("comment", { token: "r1" });
		expect(owner.frames).toHaveLength(2);
		expect(reader.frames).toHaveLength(2);
	});

	test("ends a stream with the frame it was last told", () => {
		const { streams } = review();
		const owner = page();
		streams.add(owner.sink, { key: "owner" });

		streams.end("closed");

		expect(owner.ended).toEqual(["data: closed\n\n"]);
		expect(owner.frames).toEqual([]);
	});

	test("a frameless end closes the stream and writes nothing, which is what a teardown wants", () => {
		const { streams } = review();
		const owner = page();
		streams.add(owner.sink, { key: "owner" });

		streams.end();

		expect(owner.closed.count).toBe(1);
		expect(owner.ended).toEqual([]);
		expect(owner.frames).toEqual([]);
	});

	test("counts every stream, while pageOpen counts only the lifetime's", () => {
		const { streams } = review();
		// A reader is a stream and not a page: one count notices it, the other must not.
		const reader = page();
		const owner = page();
		streams.add(reader.sink, { key: "reviewer", token: "r1" });
		streams.add(owner.sink, { key: "owner" });

		expect(streams.size()).toBe(2);
		expect(streams.pageOpen()).toBe(1);

		streams.remove(reader.sink);
		expect(streams.size()).toBe(1);
		expect(streams.pageOpen()).toBe(1);
	});

	test("arms the grace when the lifetime's last page closes, and stands it down on a reconnect", () => {
		const { streams, timer, abandoned } = review();
		const first = page();
		streams.add(first.sink, { key: "owner" });
		expect(streams.pageOpen()).toBe(1);

		streams.remove(first.sink);
		expect(timer.armed).toBe(1);
		expect(streams.pageOpen()).toBe(0);

		// A reload inside the grace: the timer is cancelled, and firing the armed callback would be
		// a departure that did not happen, so the case proves the cancel by firing nothing.
		const second = page();
		streams.add(second.sink, { key: "owner" });
		expect(timer.cancelled).toBe(1);
		timer.fire();
		expect(abandoned).toEqual([]);
	});

	test("reports the departure only when the grace runs out with no page open", () => {
		const { streams, timer, abandoned } = review();
		const only = page();
		streams.add(only.sink, { key: "owner" });
		streams.remove(only.sink);

		timer.fire();

		expect(abandoned).toEqual([1]);
	});

	test("a page that is not the lifetime arms nothing, and its reconnect cancels nothing", () => {
		const { streams, timer, abandoned } = review();
		const reader = page();
		streams.add(reader.sink, { key: "reviewer", token: "r1" });
		streams.remove(reader.sink);

		expect(timer.armed).toBe(0);
		expect(streams.pageOpen()).toBe(0);
		timer.fire();
		expect(abandoned).toEqual([]);
	});

	test("a settled page arms nothing, so a teardown close is silent", () => {
		const timer = graceTimer();
		const abandoned: number[] = [];
		let settled = false;
		const streams = createStreams({
			lifetime: (record) => record.key === "owner",
			onAbandoned: () => abandoned.push(1),
			graceMs: 5_000,
			schedule: timer.timer,
			settled: () => settled,
		});
		const only = page();
		streams.add(only.sink, { key: "owner" });
		settled = true;
		streams.remove(only.sink);

		expect(timer.armed).toBe(0);
		expect(abandoned).toEqual([]);
	});

	test("a plain fan-out — no lifetime — broadcasts and ends, and never arms a timer", () => {
		const timer = graceTimer();
		const streams = createStreams({ schedule: timer.timer });
		const one = page();
		const two = page();
		streams.add(one.sink, { key: "card" });
		streams.add(two.sink, { key: "card" });

		streams.broadcast("changed");
		streams.remove(one.sink);
		streams.remove(two.sink);

		expect(one.frames).toEqual(["data: changed\n\n"]);
		expect(two.frames).toEqual(["data: changed\n\n"]);
		// Nothing to report to and nothing to count: a fan-out has no page whose leaving decides it.
		expect(timer.armed).toBe(0);
		expect(streams.pageOpen()).toBe(0);
	});

	test("cancelDrop stands a pending grace down, and clear drops the map", () => {
		const { streams, timer, abandoned } = review();
		const only = page();
		streams.add(only.sink, { key: "owner" });
		streams.remove(only.sink);
		expect(timer.armed).toBe(1);

		streams.cancelDrop();
		expect(timer.cancelled).toBe(1);
		timer.fire();
		expect(abandoned).toEqual([]);

		streams.add(page().sink, { key: "owner" });
		expect(streams.pageOpen()).toBe(1);
		streams.clear();
		expect(streams.pageOpen()).toBe(0);
	});
});
