/**
 * The session's one server, the prefixes mounted on it, and the LAN listener a
 * shared page borrows.
 *
 * The registry is the only place that knows what a session is serving: it binds on
 * the first mount, remembers the port so a closed page reopens where it was, keys
 * every server by Pi session id so a peer session never lands on the host's socket,
 * and closes a session's socket with its last mount. A page that goes away takes
 * only its own prefix with it.
 *
 * Pinning is the session's, not a page's: `serve.port` belongs to the first session
 * that binds, so a second session in this process (a WeChat peer loads every other
 * extension, `extensions/wechat/peer/peer-session.ts`) falls back to an OS-chosen
 * port instead of failing on the host's pin, and a second *process* is told the pin
 * is in use rather than moved off the address a bookmark names.
 *
 * Value-only: every byte of state is in the returned closure.
 */

import { lazy } from "../../lib/lazy.ts";
import type {
	HttpMount,
	MountOutcome,
	MountRequest,
	NetworkInterfaces,
	ServedMount,
	ServedServer,
	SharedListener,
} from "../../lib/http/index.ts";

/** One prefix as this session's server holds it: the mount, and the spec that remounts it. */
interface Held {
	mount: { base: string; release(): Promise<void> };
	spec: ServedMount;
}

/** One session's served state. */
interface Served {
	server: ServedServer;
	mounts: Map<string, Held>;
	/** The LAN listener every shared page of this session answers on. */
	shared?: ServedServer;
	/** The address `shared` was bound to, which a link prints. */
	address?: string;
	/** The prefixes answered on `shared`, each with the mount that frees it again. */
	sharedMounts: Map<string, { release(): Promise<void> }>;
}

/** What the registry needs besides the request it is answering. */
export interface ServeRegistryDeps {
	/** The port a session is pinned to, or `0` to pick one. */
	portFor(session: string): number;
	/** The candidate port for a session's first bind; defaults to the shared band. */
	pickPort?: () => number;
	/** The machine's interfaces; a test injects a snapshot instead. */
	interfaces: () => NetworkInterfaces;
	/** Told when a session's port comes up and when it goes away, so a chip can say so. */
	onPort?: (session: string, port: number | undefined) => void;
	/** The served-page kit; loaded on the first bind, so registration never pays for it. */
	loadServe?: () => Promise<typeof import("../../lib/http/index.ts")>;
}

/** The session's servers, as the extension's bus listener drives them. */
export interface ServeRegistry {
	/** Answer one mount request: claims it synchronously, then binds. */
	handle(request: MountRequest): void;
	/** Close one session's socket, LAN listener included. */
	closeSession(session: string): Promise<void>;
}

/** A bind that failed, or the server it produced. */
type Opened = { kind: "open"; served: Served } | { kind: "failed"; reason: string };

/**
 * Why a bind failed, naming the setting when the pinned port was the reason: a bind
 * error's own text says the address, not the key that chose it.
 */
function refusalReason(error: unknown, pinned: number | undefined): string {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (pinned !== undefined && code === "EADDRINUSE") {
		return `port ${pinned} is in use — change "port" in the bytefly.json serve section, or stop what answers on it`;
	}
	return error instanceof Error ? error.message : String(error);
}

export function createServeRegistry(deps: ServeRegistryDeps): ServeRegistry {
	const sessions = new Map<string, Served>();
	/** Binds in flight, so two pages opening together share one socket. */
	const binding = new Map<string, Promise<Opened>>();
	/** The port each session last bound, so a page that closed reopens where it was. */
	const remembered = new Map<string, number>();
	/** The session the pinned port belongs to; every later session picks its own. */
	let pinnedBy: string | undefined;
	/** The served-page kit: one load, on the first bind, shared by every later one. */
	const http = lazy(deps.loadServe ?? (() => import("../../lib/http/index.ts")));

	/** Bind `session`'s server on the pin when it is this session's to take. */
	const bind = async (session: string): Promise<Opened> => {
		const { serveHttp, randomPort } = await http.get();
		const pinned = deps.portFor(session);
		const usePin = pinned > 0 && (pinnedBy === undefined || pinnedBy === session);
		const preferred = remembered.get(session) ?? (deps.pickPort ?? randomPort)();
		try {
			const server = await serveHttp({ ports: usePin ? [pinned] : [preferred, 0] });
			if (usePin) pinnedBy = session;
			remembered.set(session, server.port);
			const served: Served = { server, mounts: new Map(), sharedMounts: new Map() };
			sessions.set(session, served);
			deps.onPort?.(session, server.port);
			return { kind: "open", served };
		} catch (error) {
			return { kind: "failed", reason: refusalReason(error, usePin ? pinned : undefined) };
		}
	};

	/** This session's server, binding it if no page has yet. */
	const open = async (session: string): Promise<Opened> => {
		const existing = sessions.get(session);
		if (existing !== undefined) return { kind: "open", served: existing };
		const inflight = binding.get(session);
		if (inflight !== undefined) return inflight;
		const started = bind(session).finally(() => binding.delete(session));
		binding.set(session, started);
		return started;
	};

	/** Withdraw one page from the LAN listener, whether it stopped sharing or closed. */
	const withdraw = async (served: Served, base: string): Promise<void> => {
		const mounted = served.sharedMounts.get(base);
		if (mounted === undefined) return;
		served.sharedMounts.delete(base);
		await mounted.release();
	};

	/** Close the LAN listener once no page on this session is sharing itself. */
	const closeLanIfEmpty = async (served: Served): Promise<void> => {
		if (served.sharedMounts.size > 0) return;
		const listener = served.shared;
		served.shared = undefined;
		served.address = undefined;
		if (listener !== undefined) await listener.close();
	};

	/** Forget a session's server, which the socket has already closed. */
	const closed = (session: string, served: Served): void => {
		if (sessions.get(session) !== served) return;
		sessions.delete(session);
		deps.onPort?.(session, undefined);
	};

	const release = async (session: string, base: string): Promise<void> => {
		const served = sessions.get(session);
		const held = served?.mounts.get(base);
		if (served === undefined || held === undefined) return;
		served.mounts.delete(base);
		// A page that closes stops being reachable from the network as well: its prefix comes
		// off the LAN listener before the loopback one, so no link outlives the page.
		await withdraw(served, base);
		await held.mount.release();
		// The last prefix takes the LAN listener with it, then the socket: a session with
		// no pages has no port to answer on.
		await closeLanIfEmpty(served);
		if (served.mounts.size > 0) return;
		closed(session, served);
		await served.server.close();
	};

	const share = async (session: string, base: string): Promise<SharedListener | undefined> => {
		const { serveHttp, lanAddresses } = await http.get();
		const served = sessions.get(session);
		const held = served?.mounts.get(base);
		if (served === undefined || held === undefined) return undefined;
		const address = served.address ?? lanAddresses(deps.interfaces())[0];
		if (address === undefined) return undefined;
		if (served.shared === undefined) {
			try {
				// The same port number on the LAN address, which keeps one link shape; an
				// OS-chosen one when that address cannot take it.
				served.shared = await serveHttp({ host: address, ports: [served.server.port, 0] });
				served.address = address;
			} catch {
				served.shared = undefined;
				served.address = undefined;
				return undefined;
			}
		}
		if (!served.sharedMounts.has(base)) {
			const lan = served.shared.mount({ ...held.spec, prefix: base });
			if (lan === undefined) return undefined;
			served.sharedMounts.set(base, lan);
		}
		return { address, origin: served.shared.origin };
	};

	const unshare = async (session: string, base: string): Promise<void> => {
		const served = sessions.get(session);
		if (served === undefined) return;
		// Stop sharing is a page leaving the network, not a counter going down: the prefix
		// comes off the listener, and the socket closes only with the last page that shared.
		await withdraw(served, base);
		await closeLanIfEmpty(served);
	};

	/** Mount `request`'s prefix, or say why this session has none. */
	const mount = async (request: MountRequest): Promise<MountOutcome> => {
		const { spec } = request;
		const opened = await open(spec.session);
		if (opened.kind === "failed") return { kind: "refused", reason: opened.reason };
		const { served } = opened;
		if (served.mounts.has(spec.prefix)) {
			return { kind: "refused", reason: `${spec.prefix} is already served on :${served.server.port}` };
		}
		const mounted = served.server.mount({
			prefix: spec.prefix,
			handler: spec.handler,
			maxBodyBytes: spec.maxBodyBytes,
			idle: spec.idle,
		});
		if (mounted === undefined) {
			return { kind: "refused", reason: `${spec.prefix} is already served on :${served.server.port}` };
		}
		served.mounts.set(mounted.base, { mount: mounted, spec });
		const handed: HttpMount = {
			base: mounted.base,
			origin: served.server.origin,
			port: served.server.port,
			release: () => release(spec.session, mounted.base),
			share: () => share(spec.session, mounted.base),
			unshare: () => unshare(spec.session, mounted.base),
		};
		return { kind: "mounted", mount: handed };
	};

	const closeSession = async (session: string): Promise<void> => {
		const served = sessions.get(session);
		remembered.delete(session);
		if (served === undefined) return;
		closed(session, served);
		served.mounts.clear();
		served.sharedMounts.clear();
		await served.shared?.close();
		served.shared = undefined;
		await served.server.close();
	};

	return {
		handle(request) {
			// A payload this extension does not recognise is left unclaimed, so the caller
			// is refused rather than answered with a page nobody serves.
			if (typeof request?.spec?.handler !== "function" || typeof request.respond !== "function") return;
			request.respond(mount(request));
		},
		closeSession,
	};
}
