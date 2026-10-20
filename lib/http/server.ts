/**
 * The socket seam shared by the two loopback servers: bind, write a response
 * out, and close.
 *
 * Everything here is behavior a caller cannot get right by accident: a bind on
 * `127.0.0.1` only, an accept-level `error` listener so a transient failure
 * cannot take the host down, a `HEAD` that sends headers and no body, a `filePath`
 * response streamed instead of buffered, and a close that is safe to call twice
 * and drops keep-alive connections. What each server does *around* this — SSE
 * streams, request bodies, session settling — stays with that server.
 */

import { createReadStream } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { ServeResponse } from "./response.ts";

/**
 * Bind `server` to `127.0.0.1:port` and resolve the port it actually bound
 * (`0` asks the OS to pick one). Rejects when the bind fails, so a caller that
 * wants a fallback can retry with another port.
 */
export async function bindLoopback(server: Server, port: number): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => reject(error);
		server.once("error", onError);
		server.listen(port, "127.0.0.1", () => {
			server.off("error", onError);
			resolve();
		});
	});
	// An accept-level failure (EMFILE and friends) is emitted on the server, and an
	// `error` event with no listener would take the host down mid-session. The
	// affected request fails on its own and is answered as an error by the caller.
	server.on("error", () => {});
	const address = server.address();
	return typeof address === "object" && address ? address.port : port;
}

/**
 * Write one routed response: headers first, then no body for `HEAD`, the file
 * for a `filePath` response, or the buffered body.
 *
 * A `stream` response is deliberately not handled here: keeping a connection
 * open is the owning server's lifecycle, so it must check `stream` before
 * calling this.
 *
 * `afterFlush` runs once a buffered body is on the wire, which is the point a
 * server may resolve a session without the client seeing a dropped connection.
 * A streamed file has no such single point, so `respond` never calls it for one.
 */
export function respond(
	request: IncomingMessage,
	response: ServerResponse,
	result: ServeResponse,
	afterFlush?: () => void,
): void {
	response.writeHead(result.status, result.headers);
	if ((request.method ?? "GET").toUpperCase() === "HEAD") {
		response.end(afterFlush);
		return;
	}
	if (result.filePath) {
		const stream = createReadStream(result.filePath);
		stream.on("error", () => response.destroy());
		stream.pipe(response);
		return;
	}
	response.end(result.body ?? "", afterFlush);
}

/**
 * An idempotent `close()` for `server`.
 *
 * The second call resolves at once, so a shutdown path and a stop path can both
 * await it. `closeAllConnections` is not on the `Server` type of every supported
 * Node version, so it is probed: without it a keep-alive connection could hold
 * the close open.
 */
export function createCloser(server: Server): () => Promise<void> {
	let closed = false;
	return () =>
		new Promise<void>((resolve) => {
			if (closed) {
				resolve();
				return;
			}
			closed = true;
			server.close(() => resolve());
			(server as { closeAllConnections?: () => void }).closeAllConnections?.();
		});
}
