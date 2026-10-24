/**
 * The review's event streams: which pages are listening, what they are told, and
 * when a closed tab ends the review.
 *
 * A frame carries only a kind, so the registry is the only thing that knows who
 * is connected. It is keyed by response — a page may hold more than one stream —
 * and records the caller it belongs to, so an owner-only frame, or one revoked
 * link, can be addressed without the caller reaching into the map.
 *
 * The closed-tab rule lives here because it is a fact about streams: a reviewer's
 * tab opening or closing changes nothing, while the owner's own page going away
 * ends the review once the grace a reload needs has passed. The grace is a race
 * against that reload, so it takes the timer as a seam a test can drive by hand.
 */

import type { ServerResponse } from "node:http";
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
	/** The review is over because its owner's page went away. */
	onAbandoned: () => void;
	/** How long a closed owner tab waits for a reload before it counts as gone. */
	graceMs: number;
	/** The timer the grace is armed on. */
	schedule: ArmTimer;
	/** A settled review arms nothing, so a stream closing during teardown is silent. */
	settled: () => boolean;
}

/** The stream set one running review holds. */
export interface StreamRegistry {
	/** Register a stream, and stand down a pending closed-tab grace. */
	add(response: ServerResponse, record: StreamRecord): void;
	/** Forget a stream, arming the grace when it was the owner's last one. */
	remove(response: ServerResponse): void;
	/** Tell the open pages something changed. */
	broadcast(kind: ReviewFrame, only?: StreamFilter): void;
	/** Send one last frame and end the stream with it. */
	end(kind: ReviewFrame, only?: StreamFilter): void;
	/** Drop every stream without ending it, after they have all been ended. */
	clear(): void;
	/** Stand down the closed-tab grace, because the review is ending anyway. */
	cancelDrop(): void;
	/** How many owner streams are open. */
	ownerOpen(): number;
}

export function createStreams(deps: StreamRegistryDeps): StreamRegistry {
	const clients = new Map<ServerResponse, StreamRecord>();
	let sawOwner = false;
	let cancelDrop: (() => void) | undefined;

	const ownerOpen = (): number => {
		let open = 0;
		for (const record of clients.values()) if (record.role === "owner") open += 1;
		return open;
	};

	const cancel = (): void => {
		cancelDrop?.();
		cancelDrop = undefined;
	};

	const scheduleDrop = (): void => {
		if (ownerOpen() > 0 || !sawOwner || deps.settled() || cancelDrop) return;
		cancelDrop = deps.schedule(deps.graceMs, () => {
			cancelDrop = undefined;
			if (ownerOpen() === 0) deps.onAbandoned();
		});
	};

	const matches = (record: StreamRecord, only: StreamFilter | undefined): boolean => {
		if (only === undefined) return true;
		if (only.role !== undefined && record.role !== only.role) return false;
		if (only.token !== undefined && record.token !== only.token) return false;
		return true;
	};

	return {
		add(response, record) {
			clients.set(response, record);
			if (record.role === "owner") {
				sawOwner = true;
				cancel();
			}
		},
		remove(response) {
			const record = clients.get(response);
			clients.delete(response);
			if (record?.role === "owner") scheduleDrop();
		},
		broadcast(kind, only) {
			for (const [client, record] of clients) {
				if (!matches(record, only)) continue;
				if (client.writableEnded || client.destroyed) continue;
				client.write(`data: ${kind}\n\n`);
			}
		},
		end(kind, only) {
			for (const [client, record] of clients) {
				if (!matches(record, only)) continue;
				if (client.writableEnded || client.destroyed) continue;
				client.end(`data: ${kind}\n\n`);
			}
		},
		clear: () => clients.clear(),
		cancelDrop: cancel,
		ownerOpen,
	};
}
