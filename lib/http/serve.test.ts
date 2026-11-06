/**
 * The one loopback server: the request envelope, the body cap, the stream head and
 * its keepalive, the port retry, the idle grace, and the close.
 *
 * Every case talks to `127.0.0.1` on an OS-chosen port, which is the only way to
 * observe what a socket actually receives; nothing leaves the host. The idle
 * grace takes an injected timer and the keepalive an injected ticker, so no test
 * waits on the wall clock.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { graceTimer } from "../../test/helpers/fixtures/http.ts";
import { createConnection } from "node:net";
import { eventHeaders, RETRY_MS, textResponse } from "./index.ts";
import { type ServedServer, serveHttp } from "./serve.ts";
import { waitFor } from "../../test/helpers/process.ts";

const running: ServedServer[] = [];

afterEach(async () => {
	for (const server of running.splice(0)) await server.close();
});

/** Start a server under test and remember it for teardown. */
async function start(ports: readonly number[] = [0]): Promise<ServedServer> {
	const server = await serveHttp({ ports });
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

describe("serveHttp", () => {
	test("serves several mounts on one port, each under its own prefix", async () => {
		const server = await start();
		const board = server.mount({
			prefix: "/board",
			handler: async (r) => ({ result: textResponse(200, `board ${r.url}`) }),
		});
		const files = server.mount({
			prefix: "/files",
			handler: async (r) => ({ result: textResponse(200, `files ${r.url}`) }),
		});
		expect(board?.base).toBe("/board");
		expect(files?.port).toBe(server.port);

		// One socket, one port: the pages share the only listener the session has.
		expect(await (await fetch(`${server.origin}/board/app.js?v=1`)).text()).toBe("board /app.js?v=1");
		expect(await (await fetch(`${server.origin}/files/view/a.txt`)).text()).toBe("files /view/a.txt");
	});

	test("answers a HEAD of a stream with its head, where the same route as a GET needs a sink", async () => {
		const server = await start();
		// A `HEAD` has no body to hold open, so a mount owes it no sink; a `GET` of the same
		// route without one is the server's own failure.
		server.mount({
			prefix: "/board",
			handler: async () => ({ result: { status: 200, headers: eventHeaders(), stream: true } }),
		});

		const head = await fetch(`${server.origin}/board/events`, { method: "HEAD" });
		expect(head.status).toBe(200);
		expect(head.headers.get("content-type")).toContain("text/event-stream");
		expect(await head.text()).toBe("");
		expect((await fetch(`${server.origin}/board/events`)).status).toBe(500);
	});

	test("answers a prefix nobody claimed, and no path, as a 404", async () => {
		const server = await start();
		server.mount({ prefix: "/board", handler: async () => ({ result: textResponse(200, "ok") }) });
		expect((await fetch(`${server.origin}/plan/x/`)).status).toBe(404);
		// A prefix is a directory: `/boardX` is not inside `/board`.
		expect((await fetch(`${server.origin}/boardX`)).status).toBe(404);
	});

	test("redirects a prefix named without its slash, so relative links resolve", async () => {
		const server = await start();
		server.mount({ prefix: "/board", handler: async () => ({ result: textResponse(200, "page") }) });
		const reply = await fetch(`${server.origin}/board?token=t`, { redirect: "manual" });
		expect(reply.status).toBe(301);
		expect(reply.headers.get("location")).toBe("/board/?token=t");
	});

	test("lets a root mount and a prefixed one answer side by side", async () => {
		const server = await start();
		server.mount({ prefix: "", handler: async () => ({ result: textResponse(200, "root") }) });
		server.mount({ prefix: "/board", handler: async () => ({ result: textResponse(200, "board") }) });
		expect(await (await fetch(`${server.origin}/`)).text()).toBe("root");
		expect(await (await fetch(`${server.origin}/board/`)).text()).toBe("board");
	});

	test("reads each request under the cap of the mount it reached", async () => {
		const server = await start();
		server.mount({
			prefix: "/small",
			maxBodyBytes: 4,
			handler: async (r) => ({ result: textResponse(200, `[${r.body}]`) }),
		});
		server.mount({ prefix: "/big", handler: async (r) => ({ result: textResponse(200, `[${r.body}]`) }) });

		const kept = await fetch(`${server.origin}/small/save`, { method: "POST", body: "ok" });
		expect(await kept.text()).toBe("[ok]");
		const refused = await fetch(`${server.origin}/small/save`, { method: "POST", body: "toolarge" });
		expect(refused.status).toBe(413);
		// The neighbour sets no cap, so it reads no body at all rather than inheriting one.
		const uncapped = await fetch(`${server.origin}/big/save`, { method: "POST", body: "toolarge" });
		expect(await uncapped.text()).toBe("[]");
	});

	test("refuses a prefix that is already taken", async () => {
		const server = await start();
		expect(
			server.mount({ prefix: "/board", handler: async () => ({ result: textResponse(200, "one") }) }),
		).toBeDefined();
		expect(
			server.mount({ prefix: "/board/", handler: async () => ({ result: textResponse(200, "two") }) }),
		).toBeUndefined();
	});

	test("arms the idle grace of the mount that asked, not of the socket", async () => {
		const timer = graceTimer();
		const idled: string[] = [];
		const server = await start();
		server.mount({
			prefix: "/board",
			idle: { ms: 10, onIdle: () => idled.push("board") },
			timer: timer.timer,
			handler: async () => ({
				result: { status: 200, headers: eventHeaders(), stream: true },
				openSink: () => () => {},
			}),
		});
		server.mount({ prefix: "/files", handler: async () => ({ result: textResponse(200, "files") }) });

		const controller = new AbortController();
		await fetch(`${server.origin}/board/events`, { signal: controller.signal });
		controller.abort();
		await waitFor(() => timer.armed === 1);
		timer.fire();
		expect(idled).toEqual(["board"]);
		// The other page is untouched: one mount going quiet is not the session going idle.
		expect((await fetch(`${server.origin}/files/`)).status).toBe(200);
	});

	test("writes a keepalive comment to a quiet stream, and no event with it", async () => {
		// The ticker is the sink's own seam, so the case fires the arm this mount took rather
		// than waiting out the twenty seconds the product names.
		const ticks: (() => void)[] = [];
		const server = await start();
		server.mount({
			prefix: "/board",
			interval: (_ms, tick) => {
				ticks.push(tick);
				return () => {};
			},
			handler: async () => ({
				result: { status: 200, headers: eventHeaders(), stream: true },
				openSink: () => () => {},
			}),
		});

		const controller = new AbortController();
		const reply = await fetch(`${server.origin}/board/events`, { signal: controller.signal });
		const reader = reply.body?.getReader();
		const decoder = new TextDecoder();
		expect(decoder.decode((await reader?.read())?.value)).toBe(`retry: ${RETRY_MS}\n\n`);
		expect(ticks).toHaveLength(1);
		ticks[0]?.();
		// A comment line is what an `EventSource` skips, so the connection is proven alive
		// without a frame any page has to interpret.
		expect(decoder.decode((await reader?.read())?.value)).toBe(": keepalive\n\n");
		controller.abort();
	});

	test("closes the socket when its last mount is released, and not before", async () => {
		const server = await start();
		const board = server.mount({ prefix: "/board", handler: async () => ({ result: textResponse(200, "board") }) });
		const files = server.mount({ prefix: "/files", handler: async () => ({ result: textResponse(200, "files") }) });
		const port = server.port;

		await board?.release();
		expect(await connectionRefused(port)).toBe(false);
		expect((await fetch(`${server.origin}/board/`)).status).toBe(404);
		expect((await fetch(`${server.origin}/files/`)).status).toBe(200);

		await files?.release();
		expect(await connectionRefused(port)).toBe(true);
	});
});
