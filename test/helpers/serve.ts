/**
 * A real `serveHttp` for suites that drive a shipped page.
 *
 * A page no longer binds its own socket, so a suite that wants the shipped router on a
 * real port mounts it on one of these: the same server `serve` runs, on an OS-chosen
 * port, with the case owning its close. Nothing here fakes the socket.
 */

import {
	type HttpMount,
	type MountSource,
	type ServedServer,
	serveHttp,
	type SharedListener,
} from "../../lib/http/index.ts";

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
