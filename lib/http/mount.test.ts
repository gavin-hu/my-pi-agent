/**
 * The mount handshake: claimed by an owner that is still binding, and refused with a
 * sentence when nothing owns the session's socket.
 *
 * No socket here — the point of the contract is what a page learns *without* one, so
 * the bus double is the fixture and the `serve` extension's own suite proves the
 * other side.
 */

import { describe, expect, test } from "bun:test";
import { createFakePi } from "../../test/helpers/fakes.ts";
import {
	HTTP_MOUNT_CHANNEL,
	type HttpMount,
	type MountOutcome,
	type MountRequest,
	NO_SERVER_REASON,
	requestMount,
} from "./mount.ts";
import type { LoopbackHandler } from "./serve.ts";

const handler: LoopbackHandler = async () => ({ result: { status: 200, headers: {}, body: "" } });

/** A mount handle with nothing behind it: the suite is about the answer, not the page. */
function fakeMount(): HttpMount {
	return {
		base: "/board",
		origin: "http://127.0.0.1:4780",
		port: 4780,
		release: async () => {},
		share: async () => undefined,
		unshare: async () => {},
	};
}

const spec = { session: "s1", prefix: "/board", handler };

describe("requestMount", () => {
	test("resolves the mount an owner claims, after the bind it is still doing", async () => {
		const fake = createFakePi();
		const mount = fakeMount();
		// The owner answers synchronously with a bind that has not finished yet, which is
		// the only shape a real `server.listen` allows.
		fake.pi.events.on(HTTP_MOUNT_CHANNEL, (data: unknown) => {
			const request = data as MountRequest;
			request.respond(
				new Promise<MountOutcome>((resolve) => queueMicrotask(() => resolve({ kind: "mounted", mount }))),
			);
		});
		const outcome = await requestMount(fake.pi, spec);
		expect(outcome).toEqual({ kind: "mounted", mount });
	});

	test("refuses with a sentence when no extension owns the socket", async () => {
		const outcome = await requestMount(createFakePi().pi, spec);
		expect(outcome).toEqual({ kind: "refused", reason: NO_SERVER_REASON });
	});

	test("refuses with the owner's reason when the mount cannot be served", async () => {
		const fake = createFakePi();
		fake.pi.events.on(HTTP_MOUNT_CHANNEL, (data: unknown) => {
			(data as MountRequest).respond(Promise.resolve({ kind: "refused", reason: "/board is already mounted" }));
		});
		const outcome = await requestMount(fake.pi, spec);
		expect(outcome).toEqual({ kind: "refused", reason: "/board is already mounted" });
	});

	test("refuses with the failure when the bind throws", async () => {
		const fake = createFakePi();
		fake.pi.events.on(HTTP_MOUNT_CHANNEL, (data: unknown) => {
			(data as MountRequest).respond(Promise.reject(new Error("listen EADDRINUSE")));
		});
		const outcome = await requestMount(fake.pi, spec);
		expect(outcome).toEqual({ kind: "refused", reason: "listen EADDRINUSE" });
	});

	test("ignores a second claim, so two owners cannot answer one page", async () => {
		const fake = createFakePi();
		const first = fakeMount();
		fake.pi.events.on(HTTP_MOUNT_CHANNEL, (data: unknown) => {
			const request = data as MountRequest;
			request.respond(Promise.resolve({ kind: "mounted", mount: first }));
			request.respond(Promise.resolve({ kind: "refused", reason: "second owner" }));
		});
		const outcome = await requestMount(fake.pi, spec);
		expect(outcome).toEqual({ kind: "mounted", mount: first });
	});
});
