import { afterEach, describe, expect, test } from "bun:test";
import { createConnection } from "node:net";
import { DEFAULT_CONFIG } from "./config.ts";
import { createFileServer, type FileServer } from "./server.ts";
import { makeFixture, type Fixture } from "../../test/helpers/fixtures/file-browse.ts";
import { settle } from "../../test/helpers/process.ts";

/** Whether a TCP connection to `url`'s host:port is refused, independent of any HTTP proxy. */
function connectionRefused(url: string): Promise<boolean> {
	const { hostname, port } = new URL(url);
	return new Promise((resolve) => {
		const socket = createConnection({ host: hostname, port: Number(port) });
		const settle = (refused: boolean) => {
			socket.destroy();
			resolve(refused);
		};
		socket.once("connect", () => settle(false));
		socket.once("error", () => settle(true));
	});
}

let fixture: Fixture | undefined;
let server: FileServer | undefined;

afterEach(async () => {
	await server?.close();
	server = undefined;
	fixture?.remove();
	fixture = undefined;
});

describe("createFileServer", () => {
	test("serves listings, files, and the tree API over HTTP", async () => {
		fixture = makeFixture();
		server = await createFileServer({ root: fixture.root, config: { ...DEFAULT_CONFIG, autoOpen: false } });
		expect(server.port).toBeGreaterThan(0);
		expect(server.url.startsWith("http://127.0.0.1:")).toBe(true);

		const home = await fetch(server.url);
		expect(home.status).toBe(200);
		expect(await home.text()).toContain("read-only");

		const file = await fetch(`${server.url}view/a.txt`);
		expect(file.status).toBe(200);
		expect(await file.text()).toContain("hello");

		const tree = await fetch(`${server.url}api/tree?path=sub`);
		expect(tree.status).toBe(200);
		expect((await tree.json()) as { path: string }).toMatchObject({ path: "sub" });
	});

	test("responds to HEAD without a body", async () => {
		fixture = makeFixture();
		server = await createFileServer({ root: fixture.root, config: DEFAULT_CONFIG });
		const response = await fetch(server.url, { method: "HEAD" });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
	});

	test("streams a status frame as a page connects, then one per tick", async () => {
		fixture = makeFixture();
		server = await createFileServer({
			root: fixture.root,
			config: { ...DEFAULT_CONFIG, autoOpen: false, liveIntervalMs: 250 },
			git: async () => ({ branch: "main" }),
		});
		const controller = new AbortController();
		try {
			const reply = await fetch(`${server.url}events`, { signal: controller.signal });
			expect(reply.status).toBe(200);
			expect(reply.headers.get("content-type")).toContain("text/event-stream");
			const reader = reply.body?.getReader();
			expect(reader).toBeDefined();
			const read = async (): Promise<string> => {
				const chunk = await reader?.read();
				return new TextDecoder().decode(chunk?.value);
			};
			const first = await read();
			expect(first).toContain("retry: 2000");
			expect(first).toContain("event: status");
			const payload = JSON.parse(first.slice(first.indexOf("{"), first.lastIndexOf("}") + 1)) as {
				requests: number;
				git: { branch?: string } | null;
				uptimeMs: number;
			};
			expect(payload.git).toEqual({ branch: "main" });
			expect(payload.requests).toBeGreaterThan(0);
			expect(payload.uptimeMs).toBeGreaterThanOrEqual(0);
			// The second frame is the ticker's, so the channel is live beyond the first paint.
			await settle(400);
			expect(await read()).toContain("event: status");
		} finally {
			controller.abort();
		}
	});

	test("ends the stream when the server closes", async () => {
		fixture = makeFixture();
		const started = await createFileServer({ root: fixture.root, config: { ...DEFAULT_CONFIG, autoOpen: false } });
		server = undefined;
		const reply = await fetch(`${started.url}events`);
		const reader = reply.body?.getReader();
		expect(reader).toBeDefined();
		await reader?.read();
		await started.close();
		// The server ended the response, so the stream reports done instead of hanging.
		const done = await reader?.read();
		expect(done?.done).toBe(true);
	});

	test("answers /events with 404 when live status is off", async () => {
		fixture = makeFixture();
		server = await createFileServer({ root: fixture.root, config: { ...DEFAULT_CONFIG, live: false } });
		const reply = await fetch(`${server.url}events`);
		expect(reply.status).toBe(404);
		expect(await reply.text()).toContain("Live status is not available");
	});

	test("closes idempotently and stops accepting connections", async () => {
		fixture = makeFixture();
		const started = await createFileServer({ root: fixture.root, config: DEFAULT_CONFIG });
		const url = started.url;
		await started.close();
		await started.close();
		server = undefined;
		expect(await connectionRefused(url)).toBe(true);
	});
});
