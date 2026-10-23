/**
 * The loopback HTTP layer: the page header policy, the response builders, the
 * request-envelope helpers, and the socket seam (bind, respond, event stream,
 * close).
 *
 * The server cases talk to `127.0.0.1` on an OS-chosen port, which is the only
 * way to observe what a socket actually receives; nothing leaves the host.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { eventHeaders, jsonHeaders, PAGE_CSP, pageHeaders, scriptHeaders } from "./headers.ts";
import { htmlResponse, jsonError, jsonResponse, textResponse } from "./response.ts";
import { LOOPBACK_HOSTS } from "./router.ts";
import { hostHeaderName, isAllowedHostHeader, isLocalHostHeader, parseRequestUrl } from "./router.ts";
import { bindLoopback, createCloser, openEventStream, respond } from "./server.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A temp directory, removed at teardown. */
function scratch(prefix: string): string {
	return temps.track(tempDir(prefix));
}

/** The header sets a page-carrying response uses, by name. */
const SETS = [
	["page", pageHeaders, "text/html; charset=utf-8"],
	["script", scriptHeaders, "text/javascript; charset=utf-8"],
	["json", jsonHeaders, "application/json; charset=utf-8"],
] as const;

// --- The header policy ------------------------------------------------------

describe("the page header sets", () => {
	test("share one page policy", () => {
		for (const [name, build] of SETS) {
			expect(build()["Content-Security-Policy"], name).toBe(PAGE_CSP);
		}
	});

	test("carry the framing refusal and the no-store envelope", () => {
		for (const [name, build] of SETS) {
			const headers = build();
			expect(headers["X-Frame-Options"], name).toBe("DENY");
			expect(headers["X-Content-Type-Options"], name).toBe("nosniff");
			expect(headers["Referrer-Policy"], name).toBe("no-referrer");
			expect(headers["Cache-Control"], name).toBe("no-store");
		}
	});

	test("refuse framing, a re-pointed base, and a form submission", () => {
		// The three directives a page needs to be safe to leave open; stated once
		// here so a route cannot quietly serve a weaker policy.
		expect(PAGE_CSP).toContain("frame-ancestors 'none'");
		expect(PAGE_CSP).toContain("base-uri 'self'");
		expect(PAGE_CSP).toContain("form-action 'none'");
		expect(PAGE_CSP).toContain("default-src 'none'");
		expect(PAGE_CSP).toContain("script-src 'self'");
	});

	test("name their own content type", () => {
		for (const [name, build, contentType] of SETS) {
			expect(build()["Content-Type"], name).toBe(contentType);
		}
	});

	test("return a fresh object, so a route can add a header safely", () => {
		const first = pageHeaders();
		first.Allow = "GET, HEAD";
		expect(pageHeaders().Allow).toBeUndefined();
		expect(jsonHeaders().Allow).toBeUndefined();
	});
});

describe("eventHeaders", () => {
	test("is an event stream, not a document", () => {
		const headers = eventHeaders();
		expect(headers["Content-Type"]).toBe("text/event-stream; charset=utf-8");
		expect(headers["Cache-Control"]).toBe("no-store");
		expect(headers.Connection).toBe("keep-alive");
		expect(headers["X-Accel-Buffering"]).toBe("no");
	});

	test("claims no page policy, because the page that opens it carries one", () => {
		expect(eventHeaders()["Content-Security-Policy"]).toBeUndefined();
	});

	test("is fresh per call", () => {
		const first = eventHeaders();
		first.Connection = "close";
		expect(eventHeaders().Connection).toBe("keep-alive");
	});
});

// --- The response builders --------------------------------------------------

describe("response builders", () => {
	test("an HTML response carries the page policy", () => {
		const response = htmlResponse(200, "<p>hi</p>");
		expect(response.status).toBe(200);
		expect(response.body).toBe("<p>hi</p>");
		expect(response.headers["Content-Type"]).toContain("text/html");
		expect(response.headers["Content-Security-Policy"]).toBe(PAGE_CSP);
	});

	test("an HTML response merges the headers a route adds", () => {
		// The 405 page states its `Allow` this way; the merge must not drop the policy.
		const response = htmlResponse(405, "no", { Allow: "GET, HEAD" });
		expect(response.headers.Allow).toBe("GET, HEAD");
		expect(response.headers["Content-Security-Policy"]).toBe(PAGE_CSP);
	});

	test("a JSON response serializes once, with the JSON type", () => {
		const response = jsonResponse(200, { ok: true, items: [1, 2] });
		expect(response.body).toBe('{"ok":true,"items":[1,2]}');
		expect(response.headers["Content-Type"]).toContain("application/json");
	});

	test("the error envelope is `{ error }`", () => {
		const response = jsonError(404, "That page does not exist.");
		expect(response.status).toBe(404);
		expect(JSON.parse(String(response.body))).toEqual({ error: "That page does not exist." });
	});

	test("a text response keeps the envelope and changes only the type", () => {
		const response = textResponse(500, "Internal error");
		expect(response.body).toBe("Internal error");
		expect(response.headers["Content-Type"]).toContain("text/plain");
		expect(response.headers["X-Content-Type-Options"]).toBe("nosniff");
	});
});

// --- The request envelope ---------------------------------------------------

describe("parseRequestUrl", () => {
	test("splits a path target into its path and query", () => {
		const parsed = parseRequestUrl("/browse/sub?mode=staged&q=a%20b");
		expect(parsed?.pathname).toBe("/browse/sub");
		expect(parsed?.search.get("mode")).toBe("staged");
		expect(parsed?.search.get("q")).toBe("a b");
	});

	test("parses the root with an empty query", () => {
		const parsed = parseRequestUrl("/");
		expect(parsed?.pathname).toBe("/");
		expect([...(parsed?.search.keys() ?? [])]).toEqual([]);
	});

	test("accepts an absolute target, keeping only its own path", () => {
		// A proxy-style absolute target must not become an open redirect: the origin
		// in the target is ignored, so the route sees `/view/a.txt`.
		const parsed = parseRequestUrl("http://evil.example/view/a.txt?raw=1");
		expect(parsed?.pathname).toBe("/view/a.txt");
		expect(parsed?.search.get("raw")).toBe("1");
	});

	test("reports a malformed target instead of guessing", () => {
		expect(parseRequestUrl("http://[")).toBeUndefined();
	});
});

describe("isLocalHostHeader", () => {
	test("accepts every loopback spelling", () => {
		for (const host of ["127.0.0.1", "127.0.0.1:49152", "localhost", "localhost:8080", "[::1]", "[::1]:80"]) {
			expect(isLocalHostHeader({ host }, { required: true }), host).toBe(true);
		}
	});

	test("refuses a foreign host either way", () => {
		expect(isLocalHostHeader({ host: "evil.example" }, { required: true })).toBe(false);
		expect(isLocalHostHeader({ host: "evil.example" }, { required: false })).toBe(false);
	});

	test("a missing host is lenient only when not required", () => {
		expect(isLocalHostHeader({}, { required: false })).toBe(true);
		expect(isLocalHostHeader({}, { required: true })).toBe(false);
	});

	test("an empty or non-string host never satisfies a required check", () => {
		expect(isLocalHostHeader({ host: "" }, { required: false })).toBe(true);
		expect(isLocalHostHeader({ host: "" }, { required: true })).toBe(false);
		expect(isLocalHostHeader({ host: ["127.0.0.1"] }, { required: true })).toBe(false);
	});
});

describe("isAllowedHostHeader", () => {
	const hosts = [...LOOPBACK_HOSTS, "192.168.1.24"];

	test("accepts a name the server was bound on", () => {
		for (const host of ["127.0.0.1:8080", "localhost", "192.168.1.24:8080"]) {
			expect(isAllowedHostHeader({ host }, { hosts, required: true }), host).toBe(true);
		}
	});

	test("refuses a name it was not bound on", () => {
		expect(isAllowedHostHeader({ host: "192.168.1.25:8080" }, { hosts, required: true })).toBe(false);
		expect(isAllowedHostHeader({ host: "evil.example" }, { hosts, required: true })).toBe(false);
	});

	test("still fails closed on a missing host", () => {
		expect(isAllowedHostHeader({}, { hosts, required: true })).toBe(false);
		expect(isAllowedHostHeader({}, { hosts, required: false })).toBe(true);
	});
});

describe("hostHeaderName", () => {
	test("drops a port, lowercases, and keeps an IPv6 bracket", () => {
		expect(hostHeaderName("LocalHost:8080")).toBe("localhost");
		expect(hostHeaderName("[::1]:80")).toBe("[::1]");
		expect(hostHeaderName("192.168.1.24")).toBe("192.168.1.24");
		// A bare IPv6 address is not a port-bearing host, so nothing is stripped.
		expect(hostHeaderName("::1")).toBe("::1");
	});
});

// --- The socket seam --------------------------------------------------------

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
		const file = join(scratch("pi-http-"), "raw.txt");
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

describe("openEventStream", () => {
	test("writes the event headers and a retry hint, then streams frames", async () => {
		const server = createServer((request, response) => {
			const result = { status: 200, headers: eventHeaders() };
			openEventStream(response, result, 1500);
			response.write("event: status\ndata: {}\n\n");
			request.on("close", () => response.end());
		});
		const port = await bindLoopback(server, 0);
		const close = createCloser(server);
		const controller = new AbortController();
		try {
			const reply = await fetch(`http://127.0.0.1:${port}/events`, { signal: controller.signal });
			expect(reply.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
			const reader = reply.body?.getReader();
			expect(reader).toBeDefined();
			const first = await reader?.read();
			expect(new TextDecoder().decode(first?.value)).toStartWith("retry: 1500\n\nevent: status");
		} finally {
			controller.abort();
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
