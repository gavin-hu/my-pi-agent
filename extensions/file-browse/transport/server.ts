/**
 * The browse page's mount: the prefix it holds on the session's one server, plus the
 * live status channel it feeds.
 *
 * `lib/http` owns the socket and `serve` owns the session's port, so this module owns
 * only this page's own policy: the request handler, its request count, the cap that
 * refuses a page rather than opening a stream for it, and how long a page with nobody
 * reading it is worth keeping.
 *
 * The page takes the namespace `/files`, beside `/board` and `/plan/<id>`: every URL it
 * emits is built from that `base` — the links, the scripts, the destinations it rewrites
 * out of Markdown, and the client's own fetches — so one prefix is all it needs, and the
 * origin's root stays free. `BROWSE_BASE` is that claim, named where the mount and its
 * suite can see it.
 */

import { realpathSync } from "node:fs";
import {
	type HttpMount,
	type MountOutcome,
	type MountSource,
	type ServeResponse,
	textResponse,
} from "../../../lib/http/index.ts";
import { IDLE_STOP_MS, type ServeConfig } from "../config/config.ts";
import { createFileIndex } from "../files/files.ts";
import type { GitDiffProvider, GitStatusProvider } from "../git/git.ts";
import { createLiveChannel, createLiveStatus, movedFrameOf } from "../live/live.ts";
import { handleRequest, type ServeContext } from "./router.ts";

/**
 * The prefix this page answers under: its own namespace on the session's origin.
 *
 * Route names inside the page (`/`, `/browse`, `/view`, `/raw`, `/diff`, `/api/*`,
 * `/events`) are unchanged and relative to this prefix, so the same page is served under
 * `/files` and nowhere else, and the origin's root answers nothing at all.
 */
export const BROWSE_BASE = "/files";

/** The readers built for one root: the header's git context, and the diff view's. */
export interface RootReaders {
	/** Read-only git context for the page header; omitted when unavailable. */
	git?: GitStatusProvider;
	/** Read-only diff provider for the change and diff views; omitted when unavailable. */
	diff?: GitDiffProvider;
}

/** A mounted page. */
export interface FileServer {
	/** The page's URL, e.g. `http://127.0.0.1:4780/files/`. */
	url: string;
	/** The port the session's server bound. */
	port: number;
	/** Resolved absolute root served right now; it moves with `reroot`. */
	readonly root: string;
	/**
	 * Serve `root` from this same prefix instead, and tell every attached page, so it
	 * reloads onto it. The URL and port do not change: the prefix is the session's, not
	 * the root's. Throws when `root` cannot be resolved, leaving the page as it was.
	 */
	reroot(root: string, readers?: RootReaders): void;
	/** Give the prefix back. Safe to call more than once. */
	close(): Promise<void>;
}

/** The page, or the reason the session's server has no place for it. */
export type FileServerResult = { kind: "served"; server: FileServer } | { kind: "refused"; reason: string };

export interface FileServerOptions {
	root: string;
	config: ServeConfig;
	/** Where the prefix comes from: the session's server, or a suite's own. */
	mount: MountSource;
	/** The Pi session asking, so the prefix lands on this session's socket. */
	session: string;
	/** Read-only git context for the page header; omitted when unavailable. */
	git?: GitStatusProvider;
	/** Read-only diff provider for the change and diff views; omitted when unavailable. */
	diff?: GitDiffProvider;
	/** Called once the last page has been gone for `idleStopMs`; omitted, the mount waits for `close()`. */
	onIdle?: () => void;
	/** Grace before `onIdle`, in ms; defaults to `IDLE_STOP_MS`. */
	idleStopMs?: number;
	/** Override the request handler (tests). */
	handler?: typeof handleRequest;
}

/** Mount a read-only page rooted at `options.root` on the session's server. */
export async function createFileServer(options: FileServerOptions): Promise<FileServerResult> {
	const { config } = options;
	// What the page reads right now. One holder, so a reroot swaps the root and its
	// readers together: a render, a status frame, and a reload can never disagree.
	let current: { root: string } & RootReaders = {
		root: realpathSync.native(options.root),
		git: options.git,
		diff: options.diff,
	};
	const gitReader: GitStatusProvider = () => current.git?.() ?? Promise.resolve(undefined);
	const diffReader: GitDiffProvider = {
		list: (mode) => current.diff?.list(mode) ?? Promise.resolve(undefined),
		file: (rel, mode) => current.diff?.file(rel, mode) ?? Promise.resolve(undefined),
	};
	// The status feed's two server-owned facts: how long it has been up, and how
	// many requests it has answered. Both are read per frame, never cached.
	let requests = 0;
	const status = config.live
		? createLiveStatus({
				git: gitReader,
				diff: config.gitDiff ? diffReader : undefined,
				startedAt: Date.now(),
				requests: () => requests,
			})
		: undefined;
	const live = status ? createLiveChannel({ status, intervalMs: config.liveIntervalMs }) : undefined;
	const context: ServeContext = {
		root: current.root,
		base: BROWSE_BASE,
		config,
		git: gitReader,
		diff: diffReader,
		index: createFileIndex(current.root, config.maxIndexEntries),
		live: status,
	};
	const handler = options.handler ?? handleRequest;

	const outcome: MountOutcome = await options.mount({
		session: options.session,
		prefix: BROWSE_BASE,
		...(options.onIdle === undefined
			? {}
			: { idle: { ms: options.idleStopMs ?? IDLE_STOP_MS, onIdle: options.onIdle } }),
		async handler(request) {
			requests += 1;
			let result: ServeResponse;
			try {
				result = await handler(context, request.method, request.url, request.headers);
			} catch {
				return { result: textResponse(500, "Internal error") };
			}
			if (!result.stream || !live) return { result };
			// Checked before the head is written: a refusal must not leave a stream the
			// client would wait on. `204` is the one status an event source does not
			// reconnect after, so a page beyond the cap goes quiet instead of retrying.
			if (live.atCapacity()) {
				return { result: { status: 204, headers: { "Cache-Control": "no-store" }, body: "" } };
			}
			return {
				result,
				openSink: (sink) => live.attach({ write: (frame) => sink.write(frame), end: () => sink.end() }),
			};
		},
	});
	if (outcome.kind === "refused") return { kind: "refused", reason: outcome.reason };
	const mount: HttpMount = outcome.mount;
	return {
		kind: "served",
		server: {
			url: `${mount.origin}${mount.base}/`,
			port: mount.port,
			get root() {
				return current.root;
			},
			reroot(next, readers = {}) {
				// Resolved before anything is swapped: a root that cannot be served (a
				// removed worktree) leaves the page on the one it has.
				const resolved = realpathSync.native(next);
				current = { root: resolved, git: readers.git, diff: readers.diff };
				context.root = resolved;
				context.index = createFileIndex(resolved, config.maxIndexEntries);
				live?.announce(movedFrameOf(resolved));
			},
			close: async () => {
				// End the streams first, so a connected page does not hold the mount open.
				live?.close();
				await mount.release();
			},
		},
	};
}
