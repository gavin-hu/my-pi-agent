/**
 * A real `serveHttp` for suites that drive a shipped page.
 *
 * A page no longer binds its own socket, so a suite that wants the shipped router on a
 * real port mounts it on one of these: the same server `serve` runs, on an OS-chosen
 * port, with the case owning its close. Nothing here fakes the socket.
 *
 * A case that names a port rather than asking for one asks here first: a suite shares
 * the machine's ports with whatever else it runs, so the number it wants is a guess
 * until somebody binds it.
 */

import { createServer } from "node:net";
import {
	type HttpMount,
	type MountSource,
	type ServedServer,
	serveHttp,
	type SharedListener,
} from "../../lib/http/index.ts";

/** Whether `port` is free on loopback right now; the probe holds it only for the bind. */
export function portIsFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = createServer();
		probe.once("error", () => resolve(false));
		probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
	});
}

/**
 * A loopback port free right now, given straight back: a case that needs a number of
 * its own asks the kernel for one instead of naming it and hoping.
 */
export async function freePort(): Promise<number> {
	const probe = createServer();
	const port = await new Promise<number>((resolve) => {
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			resolve(typeof address === "object" && address ? address.port : 0);
		});
	});
	await new Promise<void>((resolve) => probe.close(() => resolve()));
	return port;
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
