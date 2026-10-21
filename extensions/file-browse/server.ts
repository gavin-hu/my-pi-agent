/**
 * The HTTP server for the browse extension.
 *
 * Wraps `node:http` around the pure `handleRequest`: it resolves the root once,
 * binds `127.0.0.1`, streams `/raw` responses from disk, feeds the live status
 * channel, and exposes an idempotent `close()`. The request handler is injectable
 * so tests can avoid a socket when they only need routing.
 *
 * The bind, the response writer, the event-stream head, and the close come from
 * `lib/http`, which `plan` shares; what stays here is this server's own request
 * handler, its request count, and the catch that turns a thrown handler into a
 * plain-text 500.
 */

import { realpathSync } from "node:fs";
import { createServer } from "node:http";
import {
	bindLoopback,
	createCloser,
	openEventStream,
	respond,
	textResponse,
	type ServeResponse,
} from "../../lib/http/index.ts";
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
	const live = status
		? createLiveChannel({
				status,
				intervalMs: config.liveIntervalMs,
				idleMs: options.idleStopMs ?? IDLE_STOP_MS,
				onIdle: options.onIdle,
			})
		: undefined;
	const context: ServeContext = {
		root,
		config,
		git: options.git,
		diff: options.diff,
		index: createFileIndex(root, config.maxIndexEntries),
		live: status,
	};
	const handler = options.handler ?? handleRequest;

	const server = createServer((request, response) => {
		requests += 1;
		const answer = async (): Promise<ServeResponse> => {
			try {
				return await handler(context, request.method ?? "GET", request.url ?? "/", request.headers);
			} catch {
				return textResponse(500, "Internal error");
			}
		};
		void answer().then((result) => {
			// A HEAD of the stream is answered as a plain response: there is no body to
			// hold open, and the client would otherwise wait on frames it asked not to get.
			if (!result.stream || !live || (request.method ?? "GET").toUpperCase() === "HEAD") {
				respond(request, response, result);
				return;
			}
			openEventStream(response, result);
			const detach = live.attach({
				write: (frame) => {
					response.write(frame);
				},
				end: () => {
					if (!response.writableEnded) response.end();
				},
			});
			request.on("close", () => {
				detach();
				if (!response.writableEnded) response.end();
			});
		});
	});

	const port = await bindLoopback(server, config.port);
	const closeServer = createCloser(server);
	return {
		url: `http://127.0.0.1:${port}/`,
		port,
		root,
		close: async () => {
			// End the streams first, so a connected page does not hold the close open.
			live?.close();
			await closeServer();
		},
	};
}
