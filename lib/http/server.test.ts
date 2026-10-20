import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { htmlResponse, textResponse } from "./response.ts";
import { bindLoopback, createCloser, respond } from "./server.ts";

let dir: string | undefined;

afterEach(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
	dir = undefined;
});

/** A scratch directory, removed by `afterEach`. */
function scratch(): string {
	dir = mkdtempSync(join(tmpdir(), "pi-http-"));
	return dir;
}

/** Whether a TCP connection to `port` is refused, independent of any HTTP client's retries. */
function connectionRefused(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: "127.0.0.1", port });
		const settle = (refused: boolean): void => {
			socket.destroy();
			resolve(refused);
		};
		socket.once("connect", () => settle(false));
		socket.once("error", () => settle(true));
	});
}

describe("bindLoopback", () => {
	test("binds a loopback port and keeps an accept-error listener", async () => {
		const server = createServer((request, response) => respond(request, response, textResponse(200, "ok")));
		const port = await bindLoopback(server, 0);
		const close = createCloser(server);
		try {
			expect(port).toBeGreaterThan(0);
			// Without this listener an accept-level error would be an unhandled `error`
			// event, which takes the host process down.
			expect(server.listenerCount("error")).toBeGreaterThan(0);
			const reply = await fetch(`http://127.0.0.1:${port}/`);
			expect(reply.status).toBe(200);
			expect(await reply.text()).toBe("ok");
		} finally {
			await close();
		}
	});
});

describe("respond", () => {
	test("sends headers and no body for HEAD", async () => {
		const server = createServer((request, response) =>
			respond(request, response, htmlResponse(200, "<!doctype html><p>body</p>")),
		);
		const port = await bindLoopback(server, 0);
		const close = createCloser(server);
		try {
			const reply = await fetch(`http://127.0.0.1:${port}/`, { method: "HEAD" });
			expect(reply.status).toBe(200);
			expect(reply.headers.get("x-frame-options")).toBe("DENY");
			expect(await reply.text()).toBe("");
		} finally {
			await close();
		}
	});

	test("streams a filePath instead of a buffered body", async () => {
		const file = join(scratch(), "raw.txt");
		writeFileSync(file, "streamed bytes");
		const server = createServer((request, response) =>
			respond(request, response, {
				status: 200,
				headers: { "Content-Type": "text/plain; charset=utf-8" },
				filePath: file,
			}),
		);
		const port = await bindLoopback(server, 0);
		const close = createCloser(server);
		try {
			const reply = await fetch(`http://127.0.0.1:${port}/`);
			expect(await reply.text()).toBe("streamed bytes");
		} finally {
			await close();
		}
	});
});

describe("createCloser", () => {
	test("closes once and is safe to call again", async () => {
		const server = createServer((request, response) => respond(request, response, textResponse(200, "ok")));
		const port = await bindLoopback(server, 0);
		const close = createCloser(server);

		expect(await connectionRefused(port)).toBe(false);
		await close();
		await close();

		expect(await connectionRefused(port)).toBe(true);
	});
});
