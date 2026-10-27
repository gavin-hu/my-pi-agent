/**
 * The contract a page and the session's one server agree on.
 *
 * A session has one port and `serve` owns it, so a page cannot bind: it *mounts* a
 * prefix and is handed back where it answers. Pi loads every extension with an
 * isolated module cache and forbids one extension importing another, so the request
 * travels on `pi.events` as an in-process request/response — the same shape as
 * `PLAN_ENTER_REQUEST` in `lib/plan-entry.ts`.
 *
 * The handshake is claimed, not awaited: a mount binds, and `server.listen` cannot
 * answer synchronously, so `respond` takes the *pending* outcome and only a request
 * no listener claimed settles as "no server". That distinction is the difference
 * between a page that starts and a page that is told the extension is missing.
 *
 * Value-only, as `lib/` must be: the state is the caller's bus and its closures.
 */

import type { NetworkInterfaceInfo } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { IdleGrace } from "./sink.ts";
import type { LoopbackHandler, Mount } from "./serve.ts";

/** EventBus channel on which a page asks the session's server for a prefix. */
export const HTTP_MOUNT_CHANNEL = "my-pi-agent/http/mount";

/** The refusal a page shows when nothing owns the session's socket. */
export const NO_SERVER_REASON = "the serve extension is not loaded, so this session has no port";

/** One page's request for a prefix on the session's server. */
export interface MountSpec {
	/**
	 * The Pi session asking. The server is per session, so a mount from another one —
	 * a WeChat peer, a second session in this process — never lands on this socket.
	 */
	session: string;
	/** The prefix it answers under, e.g. `/board`; `""` claims the whole origin. */
	prefix: string;
	handler: LoopbackHandler;
	/** Largest request body accepted here; absent, a route sees `""`. */
	maxBodyBytes?: number;
	/** Grace after this page's last reader leaves; omitted, it waits for `release()`. */
	idle?: IdleGrace;
}

/** A prefix this page now serves. */
export interface HttpMount {
	/** The prefix, normalized: `/board`. */
	base: string;
	/** `http://127.0.0.1:<port>`, the session's one origin. */
	origin: string;
	/** The port the session's server bound. */
	port: number;
	/**
	 * Free the prefix. Idempotent; the socket closes with its last mount, so a page
	 * that is done does not hold the session's port.
	 */
	release(): Promise<void>;
	/**
	 * Serve this same page on one LAN address, for a review shared with a teammate.
	 * `undefined` when the machine has no address to offer or the bind failed, so the
	 * caller keeps the sentence that explains it.
	 */
	share(): Promise<SharedListener | undefined>;
	/** Stop serving on the LAN address; the loopback mount keeps answering. */
	unshare(): Promise<void>;
}

/** The LAN address a shared page answers on. */
export interface SharedListener {
	/** The address a link names, e.g. `192.168.1.24`. */
	address: string;
	/** `http://<address>:<port>`, which may differ from the loopback port. */
	origin: string;
}

/** The machine's interfaces, as `os.networkInterfaces()` reports them. */
export type NetworkInterfaces = Record<string, NetworkInterfaceInfo[] | undefined>;

/**
 * The addresses a teammate could reach this machine on: one per non-internal IPv4
 * interface, ordered so a link is stable between calls.
 *
 * This is what a shared page is offered, never `0.0.0.0`: a review opens exactly
 * one address, so the link the owner sends is the whole surface. Link-local
 * (`169.254.*`) addresses are left out because they reach nothing.
 */
export function lanAddresses(interfaces: NetworkInterfaces): string[] {
	const addresses = new Set<string>();
	for (const entries of Object.values(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			if (entry.address === "0.0.0.0" || entry.address.startsWith("169.254.")) continue;
			addresses.add(entry.address);
		}
	}
	return [...addresses].sort(byAddress);
}

/** Numeric IPv4 comparison, so `…1.9` sorts before `…1.24`. */
function byAddress(a: string, b: string): number {
	const left = a.split(".").map(Number);
	const right = b.split(".").map(Number);
	for (let index = 0; index < 4; index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return a.localeCompare(b);
}

/**
 * The mount a bare `serveHttp` hands out, in the page-facing shape.
 *
 * A server started directly — a suite's, an embedder's — has no `serve` registry behind
 * it, so nothing can borrow a LAN listener from it. Reporting that honestly is better
 * than making every caller remember `share` is absent there.
 */
export function localMount(mount: Mount): HttpMount {
	return { ...mount, share: async () => undefined, unshare: async () => {} };
}

/** What a mount request answers with: the page's place, or the reason it has none. */
export type MountOutcome = { kind: "mounted"; mount: HttpMount } | { kind: "refused"; reason: string };

/** The question, as it travels on the bus. */
export interface MountRequest {
	spec: MountSpec;
	/**
	 * Called once, by the owner, **synchronously** with the bind it just started. A
	 * request nobody claims is a session without a server.
	 */
	respond(pending: Promise<MountOutcome>): void;
}

/** How a page asks for its prefix; the seam a caller substitutes in a test. */
export type MountSource = (spec: MountSpec) => Promise<MountOutcome>;

/**
 * Ask the session's server for `spec`'s prefix.
 *
 * Resolves `refused` with {@link NO_SERVER_REASON} when no listener claims the
 * request, so a session running without `serve` fails with a sentence instead of
 * hanging or binding a rival socket.
 */
export function requestMount(pi: Pick<ExtensionAPI, "events">, spec: MountSpec): Promise<MountOutcome> {
	return new Promise<MountOutcome>((resolve) => {
		let claimed = false;
		let settled = false;
		const settle = (outcome: MountOutcome): void => {
			if (settled) return;
			settled = true;
			resolve(outcome);
		};
		const respond = (pending: Promise<MountOutcome>): void => {
			if (claimed) return;
			claimed = true;
			pending.then(settle, (error: unknown) =>
				settle({ kind: "refused", reason: error instanceof Error ? error.message : String(error) }),
			);
		};
		pi.events.emit(HTTP_MOUNT_CHANNEL, { spec, respond } satisfies MountRequest);
		// The listener answers synchronously whether or not the bind has finished, so an
		// unclaimed request is one no extension is listening for.
		queueMicrotask(() => {
			if (!claimed) settle({ kind: "refused", reason: NO_SERVER_REASON });
		});
	});
}
