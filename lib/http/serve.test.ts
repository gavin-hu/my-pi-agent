/**
 * The one loopback server: the request envelope, the body cap, the stream head,
 * the port retry, the idle grace, and the close.
 *
 * Every case talks to `127.0.0.1` on an OS-chosen port, which is the only way to
 * observe what a socket actually receives; nothing leaves the host. The idle
 * grace takes an injected timer, so no test waits on the wall clock.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { createConnection } from "node:net";
import { eventHeaders, jsonHeaders, textResponse } from "./index.ts";
import { type LoopbackServer, serveLoopback } from "./serve.ts";
import type { ArmTimer } from "../timer.ts";
import { settle } from "../../test/helpers/process.ts";

const running: LoopbackServer[] = [];
const blockers: Server[] = [];

afterEach(async () => {
	for (const server of running.splice(0)) await server.close();
	for (const server of blockers.splice(0)) server.close();
});

/** Start a server under test and remember it for teardown. */
async function start(options: Parameters<typeof serveLoopback>[0]): Promise<LoopbackServer> {
	const server = await serveLoopback(options);
	running.push(server);
	return server;
}

/** Whether a TCP connection to `port` is refused, independent of any HTTP client's retries. */
function connectionRefused(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: "127.0.0.1", port });
		const settleIt = (refused: boolean): void => {
			socket.destroy();
			resolve(refused);
		};
		socket.once("connect", () => settleIt(false));
		socket.once("error", () => settleIt(true));
	});
}

/** A grace timer that only fires when the test says so. */
function graceTimer(): { timer: ArmTimer; fire(): void; armed: number; cancelled: number } {
	let pending: (() => void) | undefined;
	const state = {
		armed: 0,
		cancelled: 0,
		timer: ((_ms: number, run: () => void) => {
			state.armed += 1;
			pending = run;
			return () => {
				state.cancelled += 1;
				pending = undefined;
			};
		}) as ArmTimer,
		fire: () => {
			const run = pending;
			pending = undefined;
			run?.();
		},
	};
	return state;
}

describe("serveLoopback", () => {
	test("answers the handler's reply, then closes once and stops accepting", async () => {
		const server = await start({ ports: [0], handler: async () => ({ result: textResponse(200, "ok") }) });
		expect(server.port).toBeGreaterThan(0);
		expect(server.origin).toBe(`http://127.0.0.1:${server.port}`);
		const reply = await fetch(`${server.origin}/`);
		expect(reply.status).toBe(200);
		expect(await reply.text()).toBe("ok");

		expect(await connectionRefused(server.port)).toBe(false);
		await server.close();
		await server.close();
		expect(await connectionRefused(server.port)).toBe(true);
	});

	test("reads a request body under the cap", async () => {
		const server = await start({
			ports: [0],
			maxBodyBytes: 64,
			handler: async (request) => ({ result: textResponse(200, `${request.method} ${request.body}`) }),
		});
		const reply = await fetch(`${server.origin}/save`, { method: "POST", body: "notes" });
		expect(await reply.text()).toBe("POST notes");
	});

	test("answers an oversize body 413 over the open socket", async () => {
		const server = await start({
			ports: [0],
			maxBodyBytes: 8,
			handler: async () => ({ result: textResponse(200, "should not run") }),
		});
		const reply = await fetch(`${server.origin}/save`, { method: "POST", body: "x".repeat(64) });
		expect(reply.status).toBe(413);
		expect(reply.headers.get("content-type")).toBe(jsonHeaders()["Content-Type"]);
		expect(await reply.json()).toEqual({ error: "The request body is too large." });
	});

	test("reads no body at all when no cap is set", async () => {
		const server = await start({
			ports: [0],
			handler: async (request) => ({ result: textResponse(200, `[${request.body}]`) }),
		});
		const reply = await fetch(`${server.origin}/save`, { method: "POST", body: "notes" });
		expect(await reply.text()).toBe("[]");
	});

	test("streams frames until the client leaves, then detaches it", async () => {
		let detached = 0;
		const server = await start({
			ports: [0],
			handler: async () => ({
				result: { status: 200, headers: eventHeaders(), stream: true },
				openSink: (sink) => {
					sink.write("data: one\n\n");
					return () => {
						detached += 1;
					};
				},
			}),
		});
		const controller = new AbortController();
		const reply = await fetch(`${server.origin}/events`, { signal: controller.signal });
		expect(reply.headers.get("content-type")).toBe(eventHeaders()["Content-Type"]);
		const reader = reply.body?.getReader();
		const first = await reader?.read();
		expect(new TextDecoder().decode(first?.value)).toStartWith("retry: 2000\n\ndata: one");
		controller.abort();
		await settle();
		expect(detached).toBe(1);
	});

	test("answers a HEAD of a stream as a plain response, opening nothing", async () => {
		let opened = 0;
		const server = await start({
			ports: [0],
			handler: async () => ({
				result: { status: 200, headers: eventHeaders(), stream: true },
				openSink: () => {
					opened += 1;
					return () => {};
				},
			}),
		});
		const reply = await fetch(`${server.origin}/events`, { method: "HEAD" });
		expect(reply.status).toBe(200);
		expect(opened).toBe(0);
		expect(await reply.text()).toBe("");
	});

	test("refuses a stream reply that offers no sink", async () => {
		const server = await start({
			ports: [0],
			handler: async () => ({ result: { status: 200, headers: eventHeaders(), stream: true } }),
		});
		const reply = await fetch(`${server.origin}/events`);
		expect(reply.status).toBe(500);
	});

	test("answers a thrown handler as a 500 instead of dropping the request", async () => {
		const server = await start({
			ports: [0],
			handler: () => {
				throw new Error("route exploded");
			},
		});
		const reply = await fetch(`${server.origin}/`);
		expect(reply.status).toBe(500);
		expect(await reply.text()).toBe("Internal error");
	});

	test("falls back to the next port when the first is taken", async () => {
		const blocker = createServer(() => {});
		blockers.push(blocker);
		const taken = await new Promise<number>((resolve) => {
			blocker.listen(0, "127.0.0.1", () => {
				const address = blocker.address();
				resolve(typeof address === "object" && address ? address.port : 0);
			});
		});
		const server = await start({ ports: [taken, 0], handler: async () => ({ result: textResponse(200, "ok") }) });
		expect(server.port).not.toBe(taken);
		expect((await fetch(`${server.origin}/`)).status).toBe(200);
	});

	test("even the server's own idle grace leaves the grace to the caller", async () => {
		const timer = graceTimer();
		let idled = 0;
		const server = await start({
			ports: [0],
			idle: { ms: 10, onIdle: () => (idled += 1) },
			timer: timer.timer,
			handler: async () => ({
				result: { status: 200, headers: eventHeaders(), stream: true },
				openSink: () => () => {},
			}),
		});
		const controller = new AbortController();
		await fetch(`${server.origin}/events`, { signal: controller.signal });
		expect(timer.armed).toBe(0);
		controller.abort();
		await settle();
		expect(timer.armed).toBe(1);
		timer.fire();
		expect(idled).toBe(1);
	});

	test("ends an open sink when the server closes", async () => {
		let detached = 0;
		const server = await serveLoopback({
			ports: [0],
			handler: async () => ({
				result: { status: 200, headers: eventHeaders(), stream: true },
				openSink: (sink) => {
					sink.write("data: one\n\n");
					return () => {
						detached += 1;
					};
				},
			}),
		});
		const reply = await fetch(`${server.origin}/events`);
		await server.close();
		// The stream completed rather than hanging, and the route was told to detach.
		expect(await reply.text()).toBe("retry: 2000\n\ndata: one\n\n");
		expect(detached).toBe(1);
	});
});
