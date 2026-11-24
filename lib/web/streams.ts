/**
 * The served pages' event streams: which pages are listening, what they are told, and — when a
 * consumer asks for it — when a closed tab ends the session that serves them.
 *
 * A frame carries only a kind, so the registry is the only thing that knows who is connected. It
 * is keyed by sink — a page may hold more than one stream — and records a `key` and an optional
 * `token` for the caller it belongs to, so a frame for one kind of reader, or one revoked link,
 * can be addressed without the caller reaching into the map. Liveness is the sink's own (a write
 * after the end is a no-op), so the registry never asks the socket whether it is still writable.
 *
 * **The closed-tab rule is optional, because it is one consumer's meaning rather than a stream's.**
 * A page that must outlive its tabs — plan's owner page, a view's only reader — passes `lifetime`,
 * and the registry reports a page that went away after the grace a reload needs. A plain fan-out
 * (a board's cards, a browse page's tree) passes none of it and arms nothing: what a closed tab
 * means is the page's business, and a registry that required a lifetime would fit one consumer and
 * no other.
 *
 * The grace is a race against that reload, so it takes the timer as a seam a test drives by hand.
 *
 * **Two files, two halves of one pipe, and the names do not carry the difference.** This is the
 * server's side — who is connected to a page's stream. The client's side is `liveStream` in
 * `lib/web/client-runtime.ts`, the `EventSource` state machine each page's bundle follows; its suite
 * is `live-stream.test.ts` and this one is `streams.test.ts`. So this module stays out of
 * `lib/web/index.ts`'s barrel, which a browser bundle splices: it imports `lib/http`'s sink and
 * `lib/timer`'s arm, and nothing that reaches a page.
 */

import type { EventSink } from "../http/index.ts";
import type { ArmTimer } from "../timer.ts";

/** One stream's caller: what kind of page it is, and the token that names it when it has one. */
export interface StreamRecord {
	readonly key: string;
	readonly token?: string;
}

/** Which streams a frame is for; absent means every open page. */
export interface StreamFilter {
	readonly key?: string;
	readonly token?: string;
}

/**
 * What a consumer may tell the registry about the session it serves.
 *
 * The four grace fields go together: a registry with no `lifetime` arms nothing and ignores them,
 * and one with a `lifetime` needs `onAbandoned`, `graceMs` and `schedule` to have somewhere to
 * report to and something to wait on.
 */
export interface StreamRegistryDeps {
	/**
	 * Whether a record is the page whose leaving decides this session. Absent is a plain fan-out:
	 * no page's departure ends anything, and the session closes when its owner says so.
	 */
	readonly lifetime?: (record: StreamRecord) => boolean;
	/** The session is over because that page went away. Read only with `lifetime`. */
	onAbandoned?: () => void;
	/** How long a closed page waits for a reload before it counts as gone. */
	graceMs?: number;
	/** The timer the grace is armed on. */
	schedule?: ArmTimer;
	/** A settled session arms nothing, so a stream closing during teardown is silent. */
	settled?: () => boolean;
}

/** The stream set one running page holds. */
export interface StreamRegistry {
	/** Register a stream, and stand down a pending closed-tab grace. */
	add(sink: EventSink, record: StreamRecord): void;
	/** Forget a stream, arming the grace when it was the last one of the lifetime's page. */
	remove(sink: EventSink): void;
	/** Tell the open pages something changed. */
	broadcast(kind: string, only?: StreamFilter): void;
	/**
	 * End every matching stream: with one last frame when a kind is given, and silently when it is
	 * absent. A page being told why it is over reads the frame; a server shutting down has nobody
	 * left to read one, so the frameless call is a teardown rather than a message.
	 */
	end(kind?: string, only?: StreamFilter): void;
	/** Drop every stream without ending it, after they have all been ended. */
	clear(): void;
	/** Stand down the closed-tab grace, because the page is ending anyway. */
	cancelDrop(): void;
	/** Every open stream, whatever page it belongs to — the count a fan-out reads. */
	size(): number;
	/** Only the lifetime's pages, for the closed-tab rule; `0` when no lifetime was given. */
	pageOpen(): number;
}

export function createStreams(deps: StreamRegistryDeps): StreamRegistry {
	const clients = new Map<EventSink, StreamRecord>();
	const isLifetime = (record: StreamRecord): boolean => deps.lifetime?.(record) ?? false;
	let sawPage = false;
	let cancelDrop: (() => void) | undefined;

	const pageOpen = (): number => {
		let open = 0;
		for (const record of clients.values()) if (isLifetime(record)) open += 1;
		return open;
	};

	const cancel = (): void => {
		cancelDrop?.();
		cancelDrop = undefined;
	};

	const scheduleDrop = (): void => {
		const { onAbandoned, graceMs, schedule, settled } = deps;
		if (onAbandoned === undefined || graceMs === undefined || schedule === undefined) return;
		if (pageOpen() > 0 || !sawPage || settled?.() === true || cancelDrop) return;
		cancelDrop = schedule(graceMs, () => {
			cancelDrop = undefined;
			if (pageOpen() === 0) onAbandoned();
		});
	};

	const matches = (record: StreamRecord, only: StreamFilter | undefined): boolean => {
		if (only === undefined) return true;
		if (only.key !== undefined && record.key !== only.key) return false;
		if (only.token !== undefined && record.token !== only.token) return false;
		return true;
	};

	return {
		add(sink, record) {
			clients.set(sink, record);
			if (isLifetime(record)) {
				sawPage = true;
				cancel();
			}
		},
		remove(sink) {
			const record = clients.get(sink);
			clients.delete(sink);
			if (record !== undefined && isLifetime(record)) scheduleDrop();
		},
		broadcast(kind, only) {
			for (const [client, record] of clients) {
				if (!matches(record, only)) continue;
				client.write(`data: ${kind}\n\n`);
			}
		},
		end(kind, only) {
			for (const [client, record] of clients) {
				if (!matches(record, only)) continue;
				if (kind === undefined) client.end();
				else client.end(`data: ${kind}\n\n`);
			}
		},
		clear: () => clients.clear(),
		cancelDrop: cancel,
		size: () => clients.size,
		pageOpen,
	};
}
