/**
 * The HTTP server for the serve extension.
 *
 * Wraps `node:http` around the pure `handleRequest`: it resolves the root once,
 * binds `127.0.0.1`, streams `/raw` responses from disk, and exposes an
 * idempotent `close()`. The request handler is injectable so tests can avoid a
 * socket when they only need routing.
 */

import { createReadStream, realpathSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ServeConfig } from "./config.ts";
import type { GitStatusProvider } from "./git.ts";
import { handleRequest, type ServeContext, type ServeResponse } from "./router.ts";

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
	/** Override the request handler (tests). */
	handler?: typeof handleRequest;
}

async function respond(
	request: IncomingMessage,
	response: ServerResponse,
	context: ServeContext,
	handler: typeof handleRequest,
): Promise<void> {
	let result: ServeResponse;
	try {
		result = await handler(context, request.method ?? "GET", request.url ?? "/", request.headers);
	} catch {
		result = { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Internal error" };
	}

	response.writeHead(result.status, result.headers);
	if ((request.method ?? "GET").toUpperCase() === "HEAD") {
		response.end();
		return;
	}
	if (result.filePath) {
		const stream = createReadStream(result.filePath);
		stream.on("error", () => response.destroy());
		stream.pipe(response);
		return;
	}
	response.end(result.body ?? "");
}

/** Start a read-only server rooted at `options.root` on 127.0.0.1. */
export async function createFileServer(options: FileServerOptions): Promise<FileServer> {
	const root = realpathSync.native(options.root);
	const context: ServeContext = { root, config: options.config, git: options.git };
	const handler = options.handler ?? handleRequest;

	const server = createServer((request, response) => {
		void respond(request, response, context, handler);
	});

	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => reject(error);
		server.once("error", onError);
		server.listen(options.config.port, "127.0.0.1", () => {
			server.off("error", onError);
			resolve();
		});
	});

	const address = server.address();
	const port = typeof address === "object" && address ? address.port : options.config.port;

	let closed = false;
	const close = (): Promise<void> =>
		new Promise<void>((resolve) => {
			if (closed) {
				resolve();
				return;
			}
			closed = true;
			server.close(() => resolve());
			(server as { closeAllConnections?: () => void }).closeAllConnections?.();
		});

	return { url: `http://127.0.0.1:${port}/`, port, root, close };
}
