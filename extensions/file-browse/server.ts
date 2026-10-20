/**
 * The HTTP server for the browse extension.
 *
 * Wraps `node:http` around the pure `handleRequest`: it resolves the root once,
 * binds `127.0.0.1`, streams `/raw` responses from disk, and exposes an
 * idempotent `close()`. The request handler is injectable so tests can avoid a
 * socket when they only need routing.
 *
 * The bind, the response writer, and the close come from `lib/http`, which `plan`
 * shares; what stays here is this server's own request handler and the catch that
 * turns a thrown handler into a plain-text 500.
 */

import { realpathSync } from "node:fs";
import { createServer } from "node:http";
import { bindLoopback, createCloser, respond, textResponse, type ServeResponse } from "../../lib/http/index.ts";
import type { ServeConfig } from "./config.ts";
import { createFileIndex } from "./files.ts";
import type { GitDiffProvider, GitStatusProvider } from "./git.ts";
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
	/** Override the request handler (tests). */
	handler?: typeof handleRequest;
}

/** Start a read-only server rooted at `options.root` on 127.0.0.1. */
export async function createFileServer(options: FileServerOptions): Promise<FileServer> {
	const root = realpathSync.native(options.root);
	const context: ServeContext = {
		root,
		config: options.config,
		git: options.git,
		diff: options.diff,
		index: createFileIndex(root, options.config.maxIndexEntries),
	};
	const handler = options.handler ?? handleRequest;

	const server = createServer((request, response) => {
		const answer = async (): Promise<ServeResponse> => {
			try {
				return await handler(context, request.method ?? "GET", request.url ?? "/", request.headers);
			} catch {
				return textResponse(500, "Internal error");
			}
		};
		void answer().then((result) => respond(request, response, result));
	});

	const port = await bindLoopback(server, options.config.port);
	return { url: `http://127.0.0.1:${port}/`, port, root, close: createCloser(server) };
}
