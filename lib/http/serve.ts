/**
 * One loopback server per served surface: bind, accept, route, stream, idle,
 * close.
 *
 * Both browser surfaces build the same socket around `lib/http`'s pieces, so the
 * socket lives here: an extension supplies a handler that turns one request into
 * one reply, and this module owns everything the request does not decide — the
 * body cap, `HEAD` of a stream, the event-stream head, the port retry, the idle
 * grace, and a close that is safe to call twice.
 *
 * The `Host` rule stays with each router: the allowlist is per extension, and for
 * a shared review it grows while the server is up, so it cannot be passed in
 * once.
 *
 * Value-only: the only state is what a returned closure carries.
 */

import {
	createServer,
	type IncomingHttpHeaders,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { ArmTimer } from "../timer.ts";
import { jsonHeaders } from "./headers.ts";
import { type ServeResponse, textResponse } from "./response.ts";
import { bindHost, createCloser, openEventStream, respond } from "./server.ts";
import { createSinks, type EventSink, type IdleGrace, type SinkRegistry } from "./sink.ts";

/** One request as a route sees it: the envelope, and a body already capped. */
export interface LoopbackRequest {
	/** Upper-cased method, e.g. `GET`. */
	method: string;
	/** The request target, path and query. */
	url: string;
	/** Headers exactly as the socket carried them; the router applies its `Host` rule. */
	headers: IncomingHttpHeaders;
	/** The body, read up to the cap; `""` for every method when no cap was set. */
	body: string;
}

/** What a route answers with. */
export interface LoopbackReply {
	/** The response to write. A `stream` one needs `openSink` to go with it. */
	result: ServeResponse;
	/**
	 * Runs once, on whichever comes first of the response reaching the wire and the
	 * socket closing — the point a route may settle a session without a client
	 * seeing a dropped connection.
	 */
	afterResponse?: () => void;
	/** Open the reply as an event stream; the returned function detaches it. */
	openSink?: (sink: EventSink) => () => void;
}

/** One request in, one reply out. A throw is answered as a plain 500. */
export type LoopbackHandler = (request: LoopbackRequest) => Promise<LoopbackReply> | LoopbackReply;

export interface LoopbackOptions {
	/** The address to bind; defaults to `127.0.0.1`. */
	host?: string;
	/** Ports tried in order, so a remembered port can fall back to an OS-chosen one. */
	ports: readonly number[];
	handler: LoopbackHandler;
	/** Largest body accepted; absent, no body is read and a route sees `""`. */
	maxBodyBytes?: number;
	/** Grace after the last event stream leaves; omitted, the server waits for `close()`. */
	idle?: IdleGrace;
	/** The timer the idle grace is armed on. */
	timer?: ArmTimer;
}

/** A bound loopback server. */
export interface LoopbackServer {
	/** The port it actually bound. */
	port: number;
	/** `http://<host>:<port>`, the address the caller prints. */
	origin: string;
	/**
	 * End every open stream, stop the idle grace, and close the socket. Idempotent.
	 *
	 * A last frame is the caller's to send before it calls this: closing is not a
	 * conclusion, and only the route knows what its readers were waiting for.
	 */
	close(): Promise<void>;
}

/** The one refusal this layer answers itself: a body it will not read. */
const BODY_TOO_LARGE: ServeResponse = {
	status: 413,
	headers: { ...jsonHeaders(), Connection: "close" },
	body: JSON.stringify({ error: "The request body is too large." }),
};

/** A reply that asked to stream but offered no sink cannot be served as events. */
const STREAM_WITHOUT_SINK: ServeResponse = textResponse(500, "Internal error");

/** A handler that threw, or a socket that failed after its head was written. */
const INTERNAL_ERROR: ServeResponse = textResponse(500, "Internal error");

/**
 * Bind the first port that answers, falling back in order. Rejects with the last
 * bind error, so a caller can still name the reason (`EADDRINUSE` and friends).
 */
async function bindFirst(server: Server, host: string, ports: readonly number[]): Promise<number> {
	let failure: unknown;
	for (const port of ports.length === 0 ? [0] : ports) {
		try {
			return await bindHost(server, host, port);
		} catch (error) {
			failure = error;
		}
	}
	throw failure instanceof Error ? failure : new Error(`could not bind ${host}`);
}

/**
 * Read a request body, stopping at `limit`. An oversize body is reported rather
 * than destroyed, so it can still be answered 413 over the open socket instead of
 * the client seeing a dropped connection.
 */
function readBody(request: IncomingMessage, limit: number): Promise<string | undefined> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let done = false;
		const settle = (body: string | undefined): void => {
			if (done) return;
			done = true;
			resolve(body);
		};
		request.on("data", (chunk: Buffer) => {
			if (done) return;
			size += chunk.length;
			if (size > limit) {
				chunks.length = 0;
				request.pause();
				settle(undefined);
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => settle(Buffer.concat(chunks).toString("utf-8")));
		request.on("error", () => settle(undefined));
	});
}

/** A function that runs at most once; `undefined` stays `undefined`. */
function once(fn: (() => void) | undefined): (() => void) | undefined {
	if (fn === undefined) return undefined;
	let done = false;
	return () => {
		if (done) return;
		done = true;
		fn();
	};
}

/** Route one request: read, dispatch, then answer, stream, or refuse. */
async function answer(
	request: IncomingMessage,
	response: ServerResponse,
	options: LoopbackOptions,
	sinks: SinkRegistry,
): Promise<void> {
	const method = request.method ?? "GET";
	const body = options.maxBodyBytes === undefined ? "" : await readBody(request, options.maxBodyBytes);
	if (body === undefined) {
		respond(request, response, BODY_TOO_LARGE);
		return;
	}
	let reply: LoopbackReply;
	try {
		reply = await options.handler({ method, url: request.url ?? "/", headers: request.headers, body });
	} catch {
		reply = { result: INTERNAL_ERROR };
	}
	const settle = once(reply.afterResponse);
	if (reply.result.stream === true && reply.openSink === undefined) {
		respond(request, response, STREAM_WITHOUT_SINK, settle);
		response.on("close", () => settle?.());
		return;
	}
	// A `HEAD` of a stream is a plain response: there is no body to hold open, and
	// the client would otherwise wait on frames it asked not to get.
	if (reply.openSink !== undefined && method.toUpperCase() !== "HEAD") {
		openEventStream(response, reply.result);
		const sink = sinks.open(response);
		const detach = reply.openSink(sink);
		let closed = false;
		const finish = (): void => {
			if (closed) return;
			closed = true;
			detach();
			sink.end();
			settle?.();
		};
		request.on("close", finish);
		response.on("close", finish);
		return;
	}
	respond(request, response, reply.result, settle);
	response.on("close", () => settle?.());
}

/** Start a server on the first port that binds, and close it idempotently. */
export async function serveLoopback(options: LoopbackOptions): Promise<LoopbackServer> {
	const host = options.host ?? "127.0.0.1";
	const sinks = createSinks({ idle: options.idle, timer: options.timer });
	const server = createServer((request, response) => {
		// A page that walks away mid-frame must not take the session down.
		response.on("error", () => {});
		void answer(request, response, options, sinks).catch(() => {
			// A route that failed after its head was written can only be cut off; ending
			// the socket beats a client waiting on a reply that will not come.
			if (!response.writableEnded) response.end();
		});
	});
	const port = await bindFirst(server, host, options.ports);
	// The socket is bound but no page may ever read it: a server that asked for a first
	// grace arms it here, so a browser that never came up cannot hold the port all session.
	sinks.start();
	const closeServer = createCloser(server);
	let closed = false;
	return {
		port,
		origin: `http://${host}:${port}`,
		close: async () => {
			if (closed) return;
			closed = true;
			// Streams end first: a connected page must not hold the close open.
			sinks.endAll();
			await closeServer();
		},
	};
}
