/**
 * A real `serveHttp` for suites that drive a shipped page.
 *
 * A page no longer binds its own socket, so a suite that wants the shipped router on a
 * real port mounts it on one of these: the same server `serve` runs, on an OS-chosen
 * port, with the case owning its close. Nothing here fakes the socket.
 *
 * A case that names a port rather than asking for one asks here first: a suite shares
 * the machine's ports with whatever else it runs, so the number it wants is a guess
 * until somebody binds it. Both probes reject when the machine refuses to bind at all —
 * an exhausted fd table is not a port somebody holds, and reading it as one hides it.
 */

import { createServer } from "node:net";
import { hasErrorCode, messageOf } from "../../lib/errors.ts";
import {
	type HttpMount,
	type MountSource,
	type ServedServer,
	serveHttp,
	type SharedListener,
} from "../../lib/http/index.ts";

/**
 * Whether `port` is free on loopback right now; the probe holds it only for the bind.
 * Rejects when the bind failed for a reason other than the number being taken.
 */
export function portIsFree(port: number): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", (error: unknown) => {
			if (hasErrorCode(error, "EADDRINUSE")) resolve(false);
			else reject(new Error(`could not probe port ${port}: ${messageOf(error)}`));
		});
		probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
	});
}

/**
 * A loopback port free right now, given straight back: a case that needs a number of its
 * own asks the kernel for one instead of naming it and hoping. Rejects when the machine
 * refuses to bind, rather than leaving a promise no caller can settle.
 */
export function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", (error: unknown) =>
			reject(new Error(`could not ask the kernel for a free port: ${messageOf(error)}`)),
		);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			if (typeof address !== "object" || address === null) {
				reject(new Error("the probe bound no port to give back"));
				return;
			}
			probe.close(() => resolve(address.port));
		});
	});
}

/**
 * A mount source for one page under test.
 *
 * The server starts on the first request, so a fixture stays synchronous and a case that
 * never opens a page holds no port. `share()` binds a second server on `address`, which is
 * what `serve` does with a machine's LAN address; the mount's release closes both.
 */
export function testMountSource(address = "127.0.0.1"): MountSource {
	let server: Promise<ServedServer> | undefined;
	let lan: ServedServer | undefined;
	return async (spec) => {
		// One server per suite fixture, on an OS-chosen port: the socket `serve` would give it.
		server ??= serveHttp({ ports: [0] });
		const bound = await server;
		const mounted = bound.mount({
			prefix: spec.prefix,
			handler: spec.handler,
			...(spec.maxBodyBytes === undefined ? {} : { maxBodyBytes: spec.maxBodyBytes }),
			...(spec.idle === undefined ? {} : { idle: spec.idle }),
			// The idle grace's own seam, so a case fires the arm instead of waiting it out.
			...(spec.timer === undefined ? {} : { timer: spec.timer }),
		});
		if (mounted === undefined) return { kind: "refused", reason: `${spec.prefix} is already served` };
		const mount: HttpMount = {
			base: mounted.base,
			origin: mounted.origin,
			port: mounted.port,
			release: async () => {
				await lan?.close();
				lan = undefined;
				await mounted.release();
			},
			share: async (): Promise<SharedListener | undefined> => {
				lan ??= await serveHttp({ host: address, ports: [0] });
				if (lan.mount({ ...spec, prefix: spec.prefix }) === undefined) return undefined;
				return { address, origin: lan.origin };
			},
			unshare: async () => {
				await lan?.close();
				lan = undefined;
			},
		};
		return { kind: "mounted", mount };
	};
}
