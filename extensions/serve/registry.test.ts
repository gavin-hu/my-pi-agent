/**
 * The session's servers, driven through the mount contract.
 *
 * Every case binds real sockets on `127.0.0.1`, because the facts under test are a
 * port that exists once, a second session that must not share it, and a socket that
 * closes with its last page. Nothing leaves the host, and the LAN address a share
 * uses is `127.0.0.1` injected as a non-internal interface.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { LoopbackHandler, MountOutcome, MountRequest, MountSpec } from "../../lib/http/index.ts";
import { textResponse } from "../../lib/http/index.ts";
import { createServeRegistry, type ServeRegistry, type ServeRegistryDeps } from "./registry.ts";

/** One registry under test, and the sessions it was asked to serve. */
const registries: Array<{ registry: ServeRegistry; sessions: Set<string> }> = [];
const blockers: Server[] = [];

afterEach(async () => {
	// The extension closes one session at a time, because a peer's shutdown must not
	// reach the host's socket; the teardown takes the same path.
	for (const { registry, sessions } of registries.splice(0)) {
		for (const session of sessions) await registry.closeSession(session);
	}
	for (const blocker of blockers.splice(0)) blocker.close();
});

/** A registry under test, remembered for teardown. */
function registryWith(deps: Partial<ServeRegistryDeps> = {}): ServeRegistry {
	const registry = createServeRegistry({
		portFor: () => 0,
		interfaces: () => ({}),
		...deps,
	});
	registries.push({ registry, sessions: new Set() });
	return registry;
}

/** A page that says which prefix it was reached on. */
const handler: LoopbackHandler = async (request) => ({ result: textResponse(200, `served ${request.url}`) });

/** Ask for one prefix and settle with the answer, which is what a page does. */
function ask(
	registry: ServeRegistry,
	spec: Omit<MountSpec, "handler"> & { handler?: LoopbackHandler },
): Promise<MountOutcome> {
	const request: MountSpec = { handler, ...spec };
	// Teardown closes the sessions the case actually opened, which is how the extension
	// shuts down: one session's socket at a time.
	registries.find((entry) => entry.registry === registry)?.sessions.add(request.session);
	return new Promise<MountOutcome>((resolve) => {
		const mountRequest: MountRequest = {
			spec: request,
			respond: (pending) => void pending.then(resolve),
		};
		registry.handle(mountRequest);
	});
}

/** Mount one prefix or fail the test: a case that cannot mount has nothing to assert. */
async function mounted(registry: ServeRegistry, spec: Omit<MountSpec, "handler">) {
	const outcome = await ask(registry, spec);
	if (outcome.kind !== "mounted") throw new Error(`expected a mount, got: ${outcome.reason}`);
	return outcome.mount;
}

/** An address this machine can bind, reported as the LAN one. */
const LAN = {
	en0: [
		{
			address: "127.0.0.1",
			netmask: "255.0.0.0",
			family: "IPv4" as const,
			mac: "00:00:00:00:00:00",
			internal: false,
			cidr: "127.0.0.1/8",
		},
	],
};

describe("the session's server", () => {
	test("serves two pages of one session on one port", async () => {
		const registry = registryWith();
		const board = await mounted(registry, { session: "s1", prefix: "/board" });
		const files = await mounted(registry, { session: "s1", prefix: "/files" });
		expect(files.port).toBe(board.port);
		expect(await (await fetch(`${board.origin}/board/?token=t`)).text()).toBe("served /?token=t");
		expect(await (await fetch(`${files.origin}/files/view/a.txt`)).text()).toBe("served /view/a.txt");
	});

	test("gives a second session its own server and its own port", async () => {
		const registry = registryWith();
		const first = await mounted(registry, { session: "s1", prefix: "/board" });
		const second = await mounted(registry, { session: "s2", prefix: "/board" });
		expect(second.port).not.toBe(first.port);
		// The same prefix on two sessions is two pages, not a collision.
		expect((await fetch(`${first.origin}/board/`)).status).toBe(200);
		expect((await fetch(`${second.origin}/board/`)).status).toBe(200);
	});

	test("refuses a prefix the session is already serving", async () => {
		const registry = registryWith();
		await mounted(registry, { session: "s1", prefix: "/board" });
		const second = await ask(registry, { session: "s1", prefix: "/board" });
		expect(second.kind).toBe("refused");
		expect(second.kind === "refused" ? second.reason : "").toContain("/board is already served");
	});

	test("closes the socket with its last page, and reopens on the same port", async () => {
		const seen: Array<[string, number | undefined]> = [];
		const registry = registryWith({ onPort: (session, port) => seen.push([session, port]) });
		const board = await mounted(registry, { session: "s1", prefix: "/board" });
		const files = await mounted(registry, { session: "s1", prefix: "/files" });
		const port = board.port;

		await board.release();
		// One page leaving is not the session going away: the other page still answers.
		expect((await fetch(`${files.origin}/files/`)).status).toBe(200);
		await files.release();
		await expect(fetch(`${files.origin}/files/`)).rejects.toThrow();

		const again = await mounted(registry, { session: "s1", prefix: "/board" });
		expect(again.port).toBe(port);
		expect(seen).toEqual([
			["s1", port],
			["s1", undefined],
			["s1", port],
		]);
	});

	test("closes a session's socket on shutdown, so nothing outlives it", async () => {
		const registry = registryWith();
		const board = await mounted(registry, { session: "s1", prefix: "/board" });
		await registry.closeSession("s1");
		await expect(fetch(`${board.origin}/board/`)).rejects.toThrow();
	});
});

describe("the pinned port", () => {
	test("belongs to the first session that binds, so a peer still gets a port", async () => {
		const pinned = 47917;
		const registry = registryWith({ portFor: () => pinned });
		const host = await mounted(registry, { session: "host", prefix: "/board" });
		const peer = await mounted(registry, { session: "peer", prefix: "/board" });
		expect(host.port).toBe(pinned);
		expect(peer.port).not.toBe(pinned);
	});

	test("names the setting when the pinned port is taken", async () => {
		const blocker = createServer(() => {});
		blockers.push(blocker);
		const taken = await new Promise<number>((resolve) => {
			blocker.listen(0, "127.0.0.1", () => {
				const address = blocker.address();
				resolve(typeof address === "object" && address ? address.port : 0);
			});
		});
		const registry = registryWith({ portFor: () => taken });
		const outcome = await ask(registry, { session: "s1", prefix: "/board" });
		expect(outcome.kind).toBe("refused");
		// A bookmark must not move silently: the refusal names the key that chose the port.
		expect(outcome.kind === "refused" ? outcome.reason : "").toContain('"port" in the bytefly.json serve section');
	});
});

describe("sharing one page on the LAN", () => {
	test("binds the address a link names, and stops when the page stops sharing", async () => {
		const registry = registryWith({ interfaces: () => LAN });
		const board = await mounted(registry, { session: "s1", prefix: "/board" });
		const shared = await board.share();
		expect(shared?.address).toBe("127.0.0.1");
		// The port is the listener's own, reported rather than assumed: the loopback address
		// of this fixture cannot also take the session's number, so the origin is the only
		// thing a link may be built from.
		expect(shared?.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect((await fetch(`${shared?.origin}/board/?token=r`)).status).toBe(200);

		await board.unshare();
		await expect(fetch(`${shared?.origin}/board/?token=r`)).rejects.toThrow();
		// The loopback page is untouched: unsharing is not stopping.
		expect((await fetch(`${board.origin}/board/`)).status).toBe(200);
	});

	test("shares only the page that asked, never the whole session", async () => {
		const registry = registryWith({ interfaces: () => LAN });
		const board = await mounted(registry, { session: "s1", prefix: "/board" });
		await mounted(registry, { session: "s1", prefix: "/files" });
		const shared = await board.share();
		expect((await fetch(`${shared?.origin}/board/`)).status).toBe(200);
		expect((await fetch(`${shared?.origin}/files/`)).status).toBe(404);
	});

	test("reports no address instead of inventing one", async () => {
		const registry = registryWith({ interfaces: () => ({}) });
		const board = await mounted(registry, { session: "s1", prefix: "/board" });
		expect(await board.share()).toBeUndefined();
	});
});
