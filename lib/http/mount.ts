/**
 * The contract a page and the session's one server agree on.
 *
 * A session has one port and `serve` owns it, so a page cannot bind: it *mounts* a
 * prefix and is handed back where it answers. Pi loads every extension with an
 * isolated module cache and forbids one extension importing another, so the request
 * travels on `pi.events` as an in-process request/response, on the handshake in
 * `lib/bus-request.ts`.
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
import { type BusAnswer, requestOverBus } from "../bus-request.ts";
import { messageOf } from "../errors.ts";
import type { ArmTimer } from "../timer.ts";
import type { IdleGrace } from "./sink.ts";
import type { LoopbackHandler } from "./serve.ts";

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
	/**
	 * The timer that grace is armed on; absent, the process's own.
	 *
	 * A page's grace is a minute or two of wall clock, so a test that awaits it is really
	 * betting its budget on machine load; the seam is how a case fires it instead.
	 */
	timer?: ArmTimer;
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

/** What a mount request answers with: the page's place, or the reason it has none. */
export type MountOutcome = { kind: "mounted"; mount: HttpMount } | { kind: "refused"; reason: string };

/** The question, as it travels on the bus. */
export interface MountRequest {
	spec: MountSpec;
	/**
	 * Called once, by the owner, **synchronously** with the bind it just started. A
	 * request nobody claims is a session without a server.
	 */
	respond(pending: BusAnswer<MountOutcome>): void;
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
	return requestOverBus<MountOutcome, MountRequest>(pi, {
		channel: HTTP_MOUNT_CHANNEL,
		payload: (respond) => ({ spec, respond }),
		unclaimed: () => ({ kind: "refused", reason: NO_SERVER_REASON }),
		failed: (error) => ({ kind: "refused", reason: messageOf(error) }),
	});
}
