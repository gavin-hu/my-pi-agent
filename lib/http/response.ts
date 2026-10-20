/**
 * The response shape both loopback servers answer with, and the builders that
 * pair a body with the header set it needs.
 *
 * A router returns one of these instead of touching a socket, so every route is
 * testable without a server, and `server.ts` in this directory is the only code
 * that writes one out. The shape carries the two ways a response is not a
 * buffered body — a file to stream and a stream to hold open — because those are
 * properties of the answer, not of the server that serves it.
 */

import { jsonHeaders, pageHeaders } from "./headers.ts";

/** One HTTP response, before it reaches a socket. */
export interface ServeResponse {
	/** HTTP status code. */
	status: number;
	/** Headers to send verbatim. */
	headers: Record<string, string>;
	/** The buffered body; omitted for an empty response or a streamed file. */
	body?: string | Buffer;
	/** When set, the server streams this file instead of `body`. */
	filePath?: string;
	/** When true, the server keeps the connection open as a Server-Sent Events stream. */
	stream?: boolean;
}

/** An HTML page, with any headers the route needs to add to the page policy. */
export function htmlResponse(status: number, body: string, extra?: Record<string, string>): ServeResponse {
	return { status, headers: { ...pageHeaders(), ...extra }, body };
}

/** A JSON body, serialized once. */
export function jsonResponse(status: number, value: unknown): ServeResponse {
	return { status, headers: jsonHeaders(), body: JSON.stringify(value) };
}

/** The JSON error envelope both API surfaces share: `{ error }`. */
export function jsonError(status: number, message: string): ServeResponse {
	return jsonResponse(status, { error: message });
}

/** A plain-text body, for the internal-error fallback a server sends itself. */
export function textResponse(status: number, body: string): ServeResponse {
	return { status, headers: { ...pageHeaders(), "Content-Type": "text/plain; charset=utf-8" }, body };
}
