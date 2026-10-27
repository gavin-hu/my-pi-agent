/**
 * The one loopback server a session serves its pages on: bind once, dispatch by
 * mount, stream, idle, close.
 *
 * A session has one port, so the socket cannot belong to a page. A page *mounts* a
 * path prefix on it — `/board`, `/files`, `/plan/<id>` — and the server owns
 * everything a request does not decide: the longest-prefix dispatch, the body cap
 * of whichever mount was reached, `HEAD` of a stream, the event-stream head, the
 * port retry, and a close that is safe to call twice. A mount's handler is handed
 * the request target *relative to its own prefix*, so a router keeps matching the
 * paths it always matched.
 *
 * The idle grace is per mount, not per socket: one page going quiet must not close
 * another's, so a mount carries its own open-stream registry and release, and the
 * socket closes when its last mount leaves.
 *
 * The `Host` rule stays with each router: the allowlist is per extension, and for a
 * shared review it grows while the server is up, so it cannot be passed in once.
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
import { parseRequestUrl } from "./router.ts";
import { bindHost, createCloser, openEventStream, respond } from "./server.ts";
import { createSinks, type EventSink, type IdleGrace, type SinkRegistry } from "./sink.ts";

/** One request as a route sees it: the envelope, and a body already capped. */
export interface LoopbackRequest {
	/** Upper-cased method, e.g. `GET`. */
	method: string;
	/** The request target, path and query, relative to the mount's prefix. */
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

/** One page's claim on a path prefix. */
export interface ServedMount {
	/** The prefix it answers under: `/board`, or `""` for the whole origin. */
	prefix: string;
	handler: LoopbackHandler;
	/** Largest body accepted here; absent, no body is read and a route sees `""`. */
	maxBodyBytes?: number;
	/** Grace after this mount's last stream leaves; omitted, it waits for `release()`. */
	idle?: IdleGrace;
	/** The timer this mount's idle grace is armed on. */
	timer?: ArmTimer;
}

/** A prefix served on a running server. */
export interface Mount {
	/** The normalized prefix, e.g. `/board`. */
	base: string;
	/** The port the server bound. */
	port: number;
	/** `http://<host>:<port>`, the address this mount is reached on. */
	origin: string;
	/**
	 * End this mount's streams and free its prefix. Idempotent, and the server closes
	 * with its last mount.
	 */
	release(): Promise<void>;
}

export interface ServeOptions {
	/** The address to bind; defaults to `127.0.0.1`. */
	host?: string;
	/** Ports tried in order, so a remembered port can fall back to an OS-chosen one. */
	ports: readonly number[];
}

/** A bound server, before any page has mounted on it. */
export interface ServedServer {
	/** The port it actually bound. */
	port: number;
	/** `http://<host>:<port>`, the address the caller prints. */
	origin: string;
	/**
	 * Add one prefix. `undefined` means the prefix is already taken, which a caller
	 * reports rather than lets two pages answer as one.
	 */
	mount(spec: ServedMount): Mount | undefined;
	/**
	 * End every mount's streams and close the socket. Idempotent, and what the last
	 * mount's release does on its own.
	 */
	close(): Promise<void>;
}

/** One prefix as the server holds it: its spec, its streams, and its mount handle. */
interface Route {
	spec: ServedMount;
	base: string;
	sinks: SinkRegistry;
	mount: Mount;
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

/** A prefix no mount claims, and a target no URL parser accepts. */
const NOT_FOUND: ServeResponse = textResponse(404, "Nothing is served at this path.");
const MALFORMED: ServeResponse = textResponse(400, "Malformed request URL.");

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

/** One prefix, spelled the way dispatch compares it: no trailing slash, a leading one. */
function normalizeBase(prefix: string): string {
	const trimmed = prefix.replace(/\/+$/, "");
	if (trimmed === "" || trimmed === "/") return "";
	return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Whether `base` is a prefix of `pathname` at a segment boundary; `""` covers everything. */
function prefixCovers(base: string, pathname: string): boolean {
	return base === "" || pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * The mount a path belongs to: the longest prefix that covers it, so `/plan/a` wins
 * over a bare `/plan` and a root mount is the fallback rather than the rival.
 */
function routeFor(routes: Map<string, Route>, pathname: string): Route | undefined {
	let best: Route | undefined;
	for (const route of routes.values()) {
		if (!prefixCovers(route.base, pathname)) continue;
		if (best === undefined || route.base.length > best.base.length) best = route;
	}
	return best;
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

/**
 * Route one request: pick the mount, read, dispatch, then answer, stream, or refuse.
 *
 * A request that names a prefix without its slash is redirected to the slashed form,
 * because a page's own links are relative to its directory and `/board` is not one.
 */
async function answer(
	request: IncomingMessage,
	response: ServerResponse,
	routes: Map<string, Route>,
	redirect: (to: string) => ServeResponse,
): Promise<void> {
	const method = request.method ?? "GET";
	const target = request.url ?? "/";
	const parsed = parseRequestUrl(target);
	if (!parsed) {
		respond(request, response, MALFORMED);
		return;
	}
	const route = routeFor(routes, parsed.pathname);
	if (route === undefined) {
		respond(request, response, NOT_FOUND);
		return;
	}
	if (route.base !== "" && parsed.pathname === route.base) {
		respond(request, response, redirect(`${route.base}/${parsed.search.toString() === "" ? "" : `?${parsed.search}`}`));
		return;
	}
	const rest = target.slice(route.base.length);
	const url = rest === "" ? "/" : rest.startsWith("?") ? `/${rest}` : rest;
	const limit = route.spec.maxBodyBytes;
	const body = limit === undefined ? "" : await readBody(request, limit);
	if (body === undefined) {
		respond(request, response, BODY_TOO_LARGE);
		return;
	}
	let reply: LoopbackReply;
	try {
		reply = await route.spec.handler({ method, url, headers: request.headers, body });
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
		const sink = route.sinks.open(response);
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
export async function serveHttp(options: ServeOptions): Promise<ServedServer> {
	const host = options.host ?? "127.0.0.1";
	const routes = new Map<string, Route>();
	let closed = false;
	let closeServer: (() => Promise<void>) | undefined;

	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		// Streams end first: a connected page must not hold the close open.
		const open = [...routes.values()];
		routes.clear();
		for (const route of open) route.sinks.endAll();
		await closeServer?.();
	};

	const server = createServer((request, response) => {
		// A page that walks away mid-frame must not take the session down.
		response.on("error", () => {});
		void answer(request, response, routes, (to) => ({
			status: 301,
			headers: { ...jsonHeaders(), Location: to },
			body: "",
		})).catch(() => {
			// A route that failed after its head was written can only be cut off; ending
			// the socket beats a client waiting on a reply that will not come.
			if (!response.writableEnded) response.end();
		});
	});
	const port = await bindFirst(server, host, options.ports);
	closeServer = createCloser(server);
	const origin = `http://${host}:${port}`;

	return {
		port,
		origin,
		mount(spec) {
			const base = normalizeBase(spec.prefix);
			if (routes.has(base)) return undefined;
			const sinks = createSinks({ idle: spec.idle, timer: spec.timer });
			const route: Route = {
				spec: { ...spec, prefix: base },
				base,
				sinks,
				mount: {
					base,
					port,
					origin,
					release: async () => {
						if (!routes.delete(base)) return;
						sinks.endAll();
						if (routes.size === 0) await close();
					},
				},
			};
			routes.set(base, route);
			// A mount that asked for a first grace arms it here, so a browser that never
			// came up cannot hold the prefix for the rest of the session.
			sinks.start();
			return route.mount;
		},
		close,
	};
}
