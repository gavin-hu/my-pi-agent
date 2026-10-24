/**
 * The HTTP server for the browse extension.
 *
 * Wraps the pure `handleRequest` in `lib/http`'s loopback server: it resolves the
 * root once, feeds the live status channel, and exposes an idempotent `close()`.
 * The request handler is injectable so tests can avoid a socket when they only
 * need routing.
 *
 * What stays here is this extension's own policy: the request handler, its
 * request count, the catch that turns a thrown handler into a plain-text 500, the
 * cap that refuses a page rather than opening a stream for it, and how long a
 * server with nobody reading it is worth keeping.
 */

import { realpathSync } from "node:fs";
import { type ServeResponse, serveLoopback, textResponse } from "../../lib/http/index.ts";
import { IDLE_STOP_MS, type ServeConfig } from "./config.ts";
import { createFileIndex } from "./files.ts";
import type { GitDiffProvider, GitStatusProvider } from "./git.ts";
import { createLiveChannel, createLiveStatus } from "./live.ts";
import { handleRequest, type ServeContext } from "./router.ts";

export interface FileServer {
	/** Origin URL, e.g. `http://127.0.0.1:49152/`. */
	url: string;
	/** The bound port. */
	port: number;
	/** Resolved absolute root that is actually served. */
	root: string;
	/** Stop listening. Safe to call more than once or before `listen` settles. */
	close(): Promise<void>;
}

export interface FileServerOptions {
	root: string;
	config: ServeConfig;
	/** Read-only git context for the page header; omitted when unavailable. */
	git?: GitStatusProvider;
	/** Read-only diff provider for the change and diff views; omitted when unavailable. */
	diff?: GitDiffProvider;
	/** Called once the last page has been gone for `idleStopMs`; omitted, the server waits for `close()`. */
	onIdle?: () => void;
	/** Grace before `onIdle`, in ms; defaults to `IDLE_STOP_MS`. */
	idleStopMs?: number;
	/** Override the request handler (tests). */
	handler?: typeof handleRequest;
}

/** Start a read-only server rooted at `options.root` on 127.0.0.1. */
export async function createFileServer(options: FileServerOptions): Promise<FileServer> {
	const root = realpathSync.native(options.root);
	const { config } = options;
	// The status feed's two server-owned facts: how long it has been up, and how
	// many requests it has answered. Both are read per frame, never cached.
	let requests = 0;
	const status = config.live
		? createLiveStatus({
				git: options.git,
				diff: config.gitDiff ? options.diff : undefined,
				startedAt: Date.now(),
				requests: () => requests,
			})
		: undefined;
	const live = status ? createLiveChannel({ status, intervalMs: config.liveIntervalMs }) : undefined;
	const context: ServeContext = {
		root,
		config,
		git: options.git,
		diff: options.diff,
		index: createFileIndex(root, config.maxIndexEntries),
		live: status,
	};
	const handler = options.handler ?? handleRequest;

	const server = await serveLoopback({
		ports: [config.port],
		idle: options.onIdle === undefined ? undefined : { ms: options.idleStopMs ?? IDLE_STOP_MS, onIdle: options.onIdle },
		handler: async (request) => {
			requests += 1;
			let result: ServeResponse;
			try {
				result = await handler(context, request.method, request.url, request.headers);
			} catch {
				return { result: textResponse(500, "Internal error") };
			}
			if (!result.stream || !live || request.method.toUpperCase() === "HEAD") return { result };
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

	return {
		url: `${server.origin}/`,
		port: server.port,
		root,
		close: async () => {
			// End the streams first, so a connected page does not hold the close open.
			live?.close();
			await server.close();
		},
	};
}
