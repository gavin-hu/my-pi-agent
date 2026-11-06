/**
 * The review's event streams: which pages are listening, what they are told, and
 * when a closed tab ends the review.
 *
 * A frame carries only a kind, so the registry is the only thing that knows who
 * is connected. It is keyed by sink — a page may hold more than one stream — and
 * records the caller it belongs to, so an owner-only frame, or one revoked link,
 * can be addressed without the caller reaching into the map. Liveness is the
 * sink's own (a write after the end is a no-op), so the registry never asks the
 * socket whether it is still writable.
 *
 * The closed-tab rule lives here because it is a fact about streams: a tab whose role is
 * not the session's `lifetime` changes nothing, while that page going away ends the session
 * once the grace a reload needs has passed. The lifetime is a review's owner — a reviewer's
 * tab is not the review's decision — and a view's viewer, which is the only page a view has.
 * The grace is a race against that reload, so it takes the timer as a seam a test can drive
 * by hand.
 */

import type { EventSink } from "../../lib/http/index.ts";
import type { ArmTimer } from "../../lib/timer.ts";
import type { ReviewFrame, ReviewRole } from "./types.ts";

/** Who a stream belongs to: the role it may act as, and the token that names it. */
export interface StreamRecord {
	role: ReviewRole;
	token: string;
}

/** Which streams a frame is for; absent means every open page. */
export interface StreamFilter {
	role?: ReviewRole;
	token?: string;
}

/** What the registry needs from the session whose lifetime it reports on. */
export interface StreamRegistryDeps {
	/** The session is over because the page it was for went away. */
	onAbandoned: () => void;
	/**
	 * The role whose page this session's lifetime belongs to: the owner of a review, who is
	 * the only one whose leaving is a decision, or the viewer of a view, who is the only
	 * reader it has.
	 */
	lifetime: ReviewRole;
	/** How long a closed page waits for a reload before it counts as gone. */
	graceMs: number;
	/** The timer the grace is armed on. */
	schedule: ArmTimer;
	/** A settled session arms nothing, so a stream closing during teardown is silent. */
	settled: () => boolean;
}

/** The stream set one running review holds. */
export interface StreamRegistry {
	/** Register a stream, and stand down a pending closed-tab grace. */
	add(sink: EventSink, record: StreamRecord): void;
	/** Forget a stream, arming the grace when it was the last one of the lifetime's role. */
	remove(sink: EventSink): void;
	/** Tell the open pages something changed. */
	broadcast(kind: ReviewFrame, only?: StreamFilter): void;
	/** Send one last frame and end the stream with it. */
	end(kind: ReviewFrame, only?: StreamFilter): void;
	/** Drop every stream without ending it, after they have all been ended. */
	clear(): void;
	/** Stand down the closed-tab grace, because the review is ending anyway. */
	cancelDrop(): void;
	/** How many streams of the lifetime's role are open. */
	pageOpen(): number;
}

export function createStreams(deps: StreamRegistryDeps): StreamRegistry {
	const clients = new Map<EventSink, StreamRecord>();
	let sawPage = false;
	let cancelDrop: (() => void) | undefined;

	const pageOpen = (): number => {
		let open = 0;
		for (const record of clients.values()) if (record.role === deps.lifetime) open += 1;
		return open;
	};

	const cancel = (): void => {
		cancelDrop?.();
		cancelDrop = undefined;
	};

	const scheduleDrop = (): void => {
		if (pageOpen() > 0 || !sawPage || deps.settled() || cancelDrop) return;
		cancelDrop = deps.schedule(deps.graceMs, () => {
			cancelDrop = undefined;
			if (pageOpen() === 0) deps.onAbandoned();
		});
	};

	const matches = (record: StreamRecord, only: StreamFilter | undefined): boolean => {
		if (only === undefined) return true;
		if (only.role !== undefined && record.role !== only.role) return false;
		if (only.token !== undefined && record.token !== only.token) return false;
		return true;
	};

	return {
		add(sink, record) {
			clients.set(sink, record);
			if (record.role === deps.lifetime) {
				sawPage = true;
				cancel();
			}
		},
		remove(sink) {
			const record = clients.get(sink);
			clients.delete(sink);
			if (record?.role === deps.lifetime) scheduleDrop();
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
				client.end(`data: ${kind}\n\n`);
			}
		},
		clear: () => clients.clear(),
		cancelDrop: cancel,
		pageOpen,
	};
}
