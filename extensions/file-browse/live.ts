/**
 * Live status for the browse pages.
 *
 * A page that stays open holds one event stream; this module builds the snapshot
 * it is sent, the frame that carries it, and the channel that fans it out on a
 * tick. The git and diff providers already memoize, so a tick re-reads at most
 * one `git status`, and every read failure degrades to `null`: a status feed
 * must never be able to fail a page or the server that serves it.
 *
 * The channel opens no socket of its own — the caller hands it a `write`/`end`
 * pair — so the whole feed is tested without one.
 */

import { changeDirs } from "./diff.ts";
import type { DiffList, GitDiffProvider, GitStatus, GitStatusProvider } from "./git.ts";

/**
 * The changed-path index the pages render from: the totals the changes chip
 * prints and the paths the tree and listing mark.
 */
export interface ChangeIndex {
	/** Changed paths in the scope. */
	count: number;
	/** Added lines in the scope. */
	insertions: number;
	/** Removed lines in the scope. */
	deletions: number;
	/** Changed files, root-relative. */
	files: ReadonlySet<string>;
	/** Directories that contain a changed file. */
	dirs: ReadonlySet<string>;
}

/** The marker/totals index a change list yields. */
export function changeIndexOf(list: DiffList): ChangeIndex {
	return {
		count: list.files.length,
		insertions: list.insertions,
		deletions: list.deletions,
		files: new Set(list.files.map((file) => file.rel)),
		dirs: changeDirs(list.files),
	};
}

/** A change index as it goes over the wire: sets become ordered lists. */
export interface LiveChanges {
	count: number;
	insertions: number;
	deletions: number;
	files: string[];
	dirs: string[];
}

/** One status frame's payload. */
export interface LiveSnapshot {
	/** Server wall clock when the snapshot was taken, in ms. */
	at: number;
	/** How long the server has been listening, in ms. */
	uptimeMs: number;
	/** Requests the server has answered so far, this one included. */
	requests: number;
	/** Branch or detached head, or `null` outside a repository. */
	git: GitStatus | null;
	/** Uncommitted changes against `HEAD`, or `null` when unavailable. */
	changes: LiveChanges | null;
}

/** The snapshot a streamed frame is built from. */
export interface LiveStatusSource {
	snapshot(): Promise<LiveSnapshot>;
}

export interface LiveStatusOptions {
	/** Read-only git context; omitted when the page has none. */
	git?: GitStatusProvider;
	/** Read-only diff provider; omitted when the diff view is off. */
	diff?: GitDiffProvider;
	/** When the server started listening, in ms. */
	startedAt: number;
	/** Requests answered so far, read per snapshot. */
	requests: () => number;
	/** Wall-clock seam; defaults to the real clock. */
	now?: () => number;
}

/** Read a provider, turning a rejection or an absent value into `null`. */
async function settled<T>(read: () => Promise<T | undefined>): Promise<T | null> {
	try {
		return (await read()) ?? null;
	} catch {
		return null;
	}
}

/**
 * Build the status source for one server. `snapshot` never rejects: a
 * non-repository, a failed git call, or a timeout simply leaves that field
 * `null`, and the page keeps whatever it last showed.
 */
export function createLiveStatus(options: LiveStatusOptions): LiveStatusSource {
	const now = options.now ?? (() => Date.now());
	const diff = options.diff;
	return {
		async snapshot() {
			const at = now();
			const git = options.git ? await settled(options.git) : null;
			const list = diff ? await settled(() => diff.list("head")) : null;
			const index = list ? changeIndexOf(list) : null;
			return {
				at,
				uptimeMs: Math.max(0, at - options.startedAt),
				requests: options.requests(),
				git,
				changes: index
					? {
							count: index.count,
							insertions: index.insertions,
							deletions: index.deletions,
							files: [...index.files].sort(),
							dirs: [...index.dirs].sort(),
						}
					: null,
			};
		},
	};
}

/** One server-sent event carrying a snapshot. */
export function frameOf(snapshot: LiveSnapshot): string {
	return `event: status\ndata: ${JSON.stringify(snapshot)}\n\n`;
}

/** A connected page: the two things a server can do to its stream. */
export interface LiveClient {
	/** Write one frame. */
	write(frame: string): void;
	/** End the stream. */
	end(): void;
}

/** Starts a repeating tick and returns its cancel. */
export type LiveTimer = (tick: () => void, intervalMs: number) => () => void;

/** Starts a one-shot delay and returns its cancel. */
export type LiveTimeout = (run: () => void, delayMs: number) => () => void;

/** The default ticker: a repeating timer that cannot hold the process open. */
const defaultTicker: LiveTimer = (tick, intervalMs) => {
	const handle = setInterval(tick, intervalMs);
	(handle as { unref?: () => void }).unref?.();
	return () => clearInterval(handle);
};

/** The default grace timer: one shot, and it cannot hold the process open either. */
const defaultTimeout: LiveTimeout = (run, delayMs) => {
	const handle = setTimeout(run, delayMs);
	(handle as { unref?: () => void }).unref?.();
	return () => clearTimeout(handle);
};

export interface LiveChannelOptions {
	/** What each frame carries. */
	status: LiveStatusSource;
	/** How far apart the frames are, in ms. */
	intervalMs: number;
	/** How long the last page's departure is held before `onIdle` is called, in ms. */
	idleMs: number;
	/** Called once the last page has been gone for `idleMs`; omitted, the channel only idles. */
	onIdle?: () => void;
	/** Timer seam; defaults to an unref'd interval. */
	timer?: LiveTimer;
	/** Grace seam; defaults to an unref'd timeout. */
	timeout?: LiveTimeout;
}

/** The fan-out for one server: pages attach, ticks publish, close ends them. */
export interface LiveChannel {
	/** Add a connected page, send it the current status, and return its detach. */
	attach(client: LiveClient): () => void;
	/** End every connected page, stop the ticker, and drop a pending idle stop. */
	close(): void;
}

/**
 * Build a channel for one server. The ticker runs only while at least one page
 * is attached, so an idle server does no status work at all; the idle stop is one
 * timer armed when the last page leaves and cancelled by the next page, so a
 * reload keeps the server and a closed window releases it.
 */
export function createLiveChannel(options: LiveChannelOptions): LiveChannel {
	const timer = options.timer ?? defaultTicker;
	const timeout = options.timeout ?? defaultTimeout;
	const clients = new Set<LiveClient>();
	let cancel: (() => void) | undefined;
	let cancelIdle: (() => void) | undefined;
	let inFlight = false;

	const stop = (): void => {
		cancel?.();
		cancel = undefined;
	};

	const cancelIdleStop = (): void => {
		cancelIdle?.();
		cancelIdle = undefined;
	};

	const armIdleStop = (): void => {
		if (!options.onIdle || cancelIdle) return;
		cancelIdle = timeout(() => {
			cancelIdle = undefined;
			options.onIdle?.();
		}, options.idleMs);
	};

	/** Nobody is reading a frame any more: park the ticker and start the grace. */
	const pageLeft = (): void => {
		stop();
		armIdleStop();
	};

	const send = (frame: string): void => {
		for (const client of clients) {
			try {
				client.write(frame);
			} catch {
				clients.delete(client);
			}
		}
		if (clients.size === 0) pageLeft();
	};

	// One snapshot serves every attached page, so a tick is one git read and one
	// serialization however many tabs are open.
	const publish = async (): Promise<void> => {
		if (inFlight) return;
		inFlight = true;
		try {
			send(frameOf(await options.status.snapshot()));
		} finally {
			inFlight = false;
		}
	};

	return {
		attach(client) {
			cancelIdleStop();
			clients.add(client);
			cancel ??= timer(() => void publish(), options.intervalMs);
			void publish();
			return () => {
				if (!clients.delete(client)) return;
				if (clients.size === 0) pageLeft();
			};
		},
		close() {
			cancelIdleStop();
			stop();
			for (const client of clients) client.end();
			clients.clear();
		},
	};
}
