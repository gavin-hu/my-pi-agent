/**
 * Response compression: the negotiation, the type allowlist, and what a socket
 * actually receives.
 *
 * Two layers, kept apart on purpose. The unit cases drive {@link settle} with a
 * response value, so a rule about a type, a size, a stream or a `HEAD` is stated
 * once and cheaply. The socket cases then prove the two things a value cannot:
 * that the bytes on the wire really are gzip (`node:http`'s client hands them
 * over undecoded, unlike `fetch`), and that a client which asked ends up with the
 * page it asked for.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, request } from "node:http";
import { gunzipSync } from "node:zlib";
import { scratchDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { acceptsGzip, CONTENT_ENCODING, MIN_COMPRESS_BYTES, settle } from "./compress.ts";
import { jsonHeaders, pageHeaders, scriptHeaders } from "./headers.ts";
import { type ServeResponse } from "./response.ts";
import { bindLoopback, createCloser, respond } from "./server.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A page-shaped body of at least `size` bytes, standing in for a rendered page. */
function page(size = MIN_COMPRESS_BYTES * 4): string {
	return `<!doctype html><title>t</title><p>${"x".repeat(size)}</p>`;
}

/** One buffered response of the given type, as a router would build it. */
function buffered(body: string, headers = pageHeaders()): ServeResponse {
	return { status: 200, headers, body };
}

describe("the negotiation", () => {
	const cases: readonly (readonly [string | undefined, boolean, string])[] = [
		["gzip", true, "the one encoding this build offers"],
		["GZIP", true, "the token is case-insensitive"],
		["br, gzip", true, "gzip among others"],
		["deflate, gzip;q=0.5", true, "a weight below one still accepts"],
		["x-gzip", true, "the historical alias"],
		["*", true, "a wildcard accepts anything"],
		["gzip;q=0", false, "an explicit refusal is a refusal"],
		["*;q=0", false, "a refused wildcard is refused"],
		["gzip;q=0, *", false, "an explicit token beats the wildcard"],
		["identity", false, "identity is not gzip"],
		["deflate, br", false, "nothing on offer matches"],
		[undefined, false, "no header is no request for gzip"],
		["", false, "an empty header is nothing"],
	];
	for (const [header, expected, why] of cases) {
		test(`${JSON.stringify(header ?? null)} → ${expected}: ${why}`, () => {
			expect(acceptsGzip(header)).toBe(expected);
		});
	}
});

describe("what settle answers", () => {
	test("gzip when asked, with the header naming it and the body the page", () => {
		const body = page();
		const settled = settle(buffered(body), "gzip", "GET");

		expect(settled.headers["Content-Encoding"]).toBe(CONTENT_ENCODING);
		expect(settled.headers.Vary).toBe("Accept-Encoding");
		expect(settled.headers["Content-Type"]).toBe("text/html; charset=utf-8");
		expect(settled.headers["Cache-Control"], "the envelope is kept, not replaced").toBe("no-store");
		expect(Buffer.isBuffer(settled.body)).toBe(true);
		expect(gunzipSync(settled.body as Buffer).toString("utf-8")).toBe(body);
	});

	test("identity when not asked for, and still varied", () => {
		// A cache that stored the plain variant would replay it to a client that asked
		// for gzip, so the negotiation is named on both answers.
		const settled = settle(buffered(page()), undefined, "GET");

		expect(settled.headers["Content-Encoding"]).toBeUndefined();
		expect(settled.headers.Vary).toBe("Accept-Encoding");
		expect(settled.body).toBe(page());
	});

	test("a body under the floor keeps its bytes, and is still varied", () => {
		const body = "<!doctype html><p>ok</p>";
		expect(body.length).toBeLessThan(MIN_COMPRESS_BYTES);
		const settled = settle(buffered(body), "gzip", "GET");
		expect(settled.headers["Content-Encoding"]).toBeUndefined();
		expect(settled.headers.Vary).toBe("Accept-Encoding");
		expect(settled.body).toBe(body);
	});

	test("an image is never compressed, even when the client asks", () => {
		// PNG, WEBP, MP4 and WASM arrive compressed: gzip on one costs CPU to grow it.
		const settled = settle(buffered("x".repeat(MIN_COMPRESS_BYTES * 4), jsonHeaders()), "gzip", "GET");
		expect(settled.headers["Content-Encoding"], "json is in the allowlist").toBe(CONTENT_ENCODING);

		const image: ServeResponse = { status: 200, headers: { "Content-Type": "image/png" }, body: "x".repeat(4096) };
		const untouched = settle(image, "gzip", "GET");
		expect(untouched.headers["Content-Encoding"]).toBeUndefined();
		expect(untouched.headers.Vary, "a type that is never compressible needs no vary").toBeUndefined();
		expect(untouched.body).toBe(image.body);

		const plain: ServeResponse = { status: 200, headers: { "Content-Type": "text/plain" }, body: "x".repeat(4096) };
		expect(settle(plain, "gzip", "GET").headers["Content-Encoding"]).toBeUndefined();
	});

	test("the client bundle compresses as a script", () => {
		const settled = settle(buffered("(function(){var a=1;})();".repeat(200), scriptHeaders()), "gzip", "GET");
		expect(settled.headers["Content-Encoding"]).toBe(CONTENT_ENCODING);
		expect(gunzipSync(settled.body as Buffer).toString("utf-8")).toContain("(function()");
	});

	test("a body that already names an encoding is left alone", () => {
		const image: ServeResponse = {
			status: 200,
			headers: { "Content-Type": "text/html", "Content-Encoding": "br" },
			body: page(),
		};
		const settled = settle(image, "gzip", "GET");
		expect(settled.headers["Content-Encoding"], "a second encode would be two encodings").toBe("br");
		expect(settled.body).toBe(image.body);
	});

	test("a streamed file and an event stream pass through untouched", () => {
		const file: ServeResponse = { status: 200, headers: { "Content-Type": "image/png" }, filePath: "/tmp/x.png" };
		expect(settle(file, "gzip", "GET")).toBe(file);

		const stream: ServeResponse = { status: 200, headers: { "Content-Type": "text/event-stream" }, stream: true };
		expect(settle(stream, "gzip", "GET")).toBe(stream);
	});

	test("an empty response has nothing to weigh", () => {
		const empty: ServeResponse = { status: 204, headers: pageHeaders() };
		expect(settle(empty, "gzip", "GET")).toBe(empty);
	});

	test("an existing Vary gains the token once, never twice", () => {
		const withCookie = settle(buffered(page(), { ...pageHeaders(), Vary: "Cookie" }), "gzip", "GET");
		expect(withCookie.headers.Vary).toBe("Cookie, Accept-Encoding");

		const already = settle(buffered(page(), { ...pageHeaders(), Vary: "accept-encoding" }), "gzip", "GET");
		expect(already.headers.Vary).toBe("accept-encoding");
	});

	test("a HEAD answers the headers its GET would, without building the body", () => {
		const get = settle(buffered(page()), "gzip", "GET");
		const head = settle(buffered(page()), "gzip", "HEAD");

		expect(head.headers).toEqual(get.headers);
		expect(head.body, "the body a HEAD would have sent is never compressed").toBe(page());
	});

	test("a Buffer body compresses to the same bytes as a string one", () => {
		const text = page();
		const fromString = settle({ status: 200, headers: pageHeaders(), body: text }, "gzip", "GET");
		const fromBuffer = settle({ status: 200, headers: pageHeaders(), body: Buffer.from(text, "utf-8") }, "gzip", "GET");
		expect((fromBuffer.body as Buffer).equals(fromString.body as Buffer)).toBe(true);
	});
});

// --- What a socket receives ------------------------------------------------

/** Answer every request with one fixed response, and hand back its origin. */
async function serveFixed(result: ServeResponse): Promise<{ origin: string; close: () => Promise<void> }> {
	const server = createServer((incoming, outgoing) => respond(incoming, outgoing, result));
	const port = await bindLoopback(server, 0);
	const close = createCloser(server);
	return { origin: `http://127.0.0.1:${port}`, close };
}

/** One request whose body arrives undecoded: `fetch` decompresses, so it cannot answer this. */
function rawGet(
	origin: string,
	headers: Record<string, string>,
	method = "GET",
): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
	const url = new URL(origin);
	return new Promise((resolve, reject) => {
		const req = request({ host: url.hostname, port: url.port, path: "/", method, headers }, (reply) => {
			const chunks: Buffer[] = [];
			reply.on("data", (chunk: Buffer) => chunks.push(chunk));
			reply.on("end", () =>
				resolve({ status: reply.statusCode ?? 0, headers: reply.headers, body: Buffer.concat(chunks) }),
			);
			reply.on("error", reject);
		});
		req.on("error", reject);
		req.end();
	});
}

describe("what a socket receives", () => {
	test("the bytes on the wire are gzip, and they are the page", async () => {
		const body = page();
		const served = await serveFixed(buffered(body));
		try {
			const reply = await rawGet(served.origin, { "accept-encoding": "gzip" });

			expect(reply.status).toBe(200);
			expect(reply.headers["content-encoding"]).toBe(CONTENT_ENCODING);
			expect(reply.headers.vary).toBe("Accept-Encoding");
			expect(reply.body.length, "compressed, so smaller than the page").toBeLessThan(body.length);
			expect(gunzipSync(reply.body).toString("utf-8")).toBe(body);
		} finally {
			await served.close();
		}
	});

	test("a client that did not ask gets the page as it was built", async () => {
		const body = page();
		const served = await serveFixed(buffered(body));
		try {
			const reply = await rawGet(served.origin, {});

			expect(reply.headers["content-encoding"]).toBeUndefined();
			expect(reply.headers.vary, "the contract is on the plain answer too").toBe("Accept-Encoding");
			expect(reply.body.toString("utf-8")).toBe(body);
		} finally {
			await served.close();
		}
	});

	test("a browser's own request still parses as the page", async () => {
		// The case the card asks for, from the client's side: whatever the wire carried,
		// what arrives is the document — `fetch` decodes, as a browser does.
		const body = page();
		const served = await serveFixed(buffered(body));
		try {
			const reply = await fetch(served.origin, { headers: { "accept-encoding": "gzip" } });
			const text = await reply.text();

			expect(reply.status).toBe(200);
			expect(text).toBe(body);
			expect(text.startsWith("<!doctype html>"), "it is a page, not a decoded fragment").toBe(true);
		} finally {
			await served.close();
		}
	});

	test("a HEAD carries the same headers and no body", async () => {
		const served = await serveFixed(buffered(page()));
		try {
			const get = await rawGet(served.origin, { "accept-encoding": "gzip" });
			const head = await rawGet(served.origin, { "accept-encoding": "gzip" }, "HEAD");

			expect(head.status).toBe(200);
			expect(head.headers["content-encoding"]).toBe(get.headers["content-encoding"]);
			expect(head.headers.vary).toBe(get.headers.vary);
			expect(head.body.length).toBe(0);
		} finally {
			await served.close();
		}
	});

	test("a streamed file keeps its length and its bytes", async () => {
		// Gavin's condition: `/raw` is out of scope, and the case says so rather than
		// leaving the absence to a reader's memory.
		const file = `${scratchDir(temps, "pi-compress-")}/raw.png`;
		const bytes = Buffer.from("89504e470d0a1a0a", "hex");
		writeFileSync(file, bytes);
		const served = await serveFixed({
			status: 200,
			headers: { "Content-Type": "image/png", "Content-Length": String(bytes.length) },
			filePath: file,
		});
		try {
			const reply = await rawGet(served.origin, { "accept-encoding": "gzip" });

			expect(reply.headers["content-encoding"], "a file is streamed, not compressed").toBeUndefined();
			expect(reply.headers["content-length"]).toBe(String(bytes.length));
			expect(reply.body.equals(bytes)).toBe(true);
		} finally {
			await served.close();
		}
	});

	test("a JSON reply compresses too", async () => {
		const body = JSON.stringify({ entries: Array.from({ length: 200 }, (_, index) => ({ name: `f${index}.ts` })) });
		const served = await serveFixed({ status: 200, headers: jsonHeaders(), body });
		try {
			const reply = await rawGet(served.origin, { "accept-encoding": "gzip", accept: "application/json" });
			expect(reply.headers["content-encoding"]).toBe(CONTENT_ENCODING);
			expect(JSON.parse(gunzipSync(reply.body).toString("utf-8"))).toEqual(JSON.parse(body));
		} finally {
			await served.close();
		}
	});
});
