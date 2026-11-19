/**
 * Response compression for the loopback servers: the one place a body is weighed,
 * gzipped, and labelled.
 *
 * A served page is HTML with its stylesheet inline, plus a client bundle of the same
 * kind, so every mount ships text that compresses to a quarter of itself — measured on
 * the file-browse fixture: a directory page 57,278 bytes → 14,356, the bundle 51,181 →
 * 14,594, an `/api/tree` reply 1,200 → 293. Brotli would take another ~2 KB off each on
 * loopback, which is not worth a second negotiation branch and a second set of cases
 * here; the encoding is one constant, so adding it later is a table entry rather than a
 * redesign.
 *
 * The decision is a pure function of the response and the request's `Accept-Encoding`,
 * which is what lets a `HEAD` answer its `GET`'s headers without building a body: the
 * only thing a HEAD cannot have is the compressed bytes, and it never needs them.
 *
 * Value-only: no I/O, no clock, and nothing module-level that a caller can mutate.
 */

import { gzipSync } from "node:zlib";
import type { ServeResponse } from "./response.ts";

/** The one encoding this build offers, as a `Content-Encoding` value. */
export const CONTENT_ENCODING = "gzip";

/**
 * Bodies under this many bytes are served as they are.
 *
 * Not a guess: `/theme.js` is 156 bytes and gzip saves 11 of them, while the smallest
 * reply worth compressing here (`/api/tree`) is 1,200 bytes and drops to 293. A floor
 * between the two keeps the header overhead from buying nothing.
 */
export const MIN_COMPRESS_BYTES = 1024;

/**
 * The types worth compressing — the text this server speaks.
 *
 * An allowlist rather than "not already compressed": `/raw` serves PNG, WEBP, MP4 and
 * WASM bytes that are compressed already, and gzip on one of those costs CPU to make the
 * payload larger. A type is matched by its media type, so the `; charset=utf-8` suffix
 * every builder writes is ignored.
 */
export const COMPRESSIBLE_TYPES: readonly string[] = ["text/html", "text/javascript", "application/json"];

/** A header value as Node may hand it over: one string, or the few a repeated header makes. */
type HeaderValue = string | string[] | undefined;

/** The media type of a `Content-Type` header, lowercased and stripped of its parameters. */
function mediaType(value: HeaderValue): string | undefined {
	const raw = Array.isArray(value) ? value[0] : value;
	if (raw === undefined) return undefined;
	return raw.split(";")[0]?.trim().toLowerCase();
}

/**
 * Whether a client that sent `header` accepts gzip.
 *
 * `Accept-Encoding` is a comma-separated list of codings with optional `;q=` weights.
 * This reads the two facts that matter to one encoding — an explicit `gzip`, an explicit
 * refusal (`q=0`), and a wildcard — and an explicit token beats the wildcard either way,
 * because `gzip;q=0, *` is a client saying it takes anything but gzip.
 *
 * `identity;q=0` is not acted on: the answer would be a 406 refusal this server has no
 * other reason to produce, for a request no client of ours makes.
 */
export function acceptsGzip(header: HeaderValue): boolean {
	const raw = Array.isArray(header) ? header.join(",") : header;
	if (raw === undefined) return false;
	let wildcard = false;
	for (const part of raw.split(",")) {
		const [name = "", ...params] = part.split(";");
		const coding = name.trim().toLowerCase();
		if (coding === "") continue;
		const refused = params.some((param) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/i.test(param));
		if (coding === "gzip" || coding === "x-gzip") return !refused;
		if (coding === "*" && !refused) wildcard = true;
	}
	return wildcard;
}

/** The `Vary` value that names this negotiation, keeping whatever a caller already set. */
function varyWith(existing: HeaderValue): string {
	const raw = Array.isArray(existing) ? existing.join(", ") : existing;
	if (raw === undefined || raw.trim() === "") return "Accept-Encoding";
	const named = raw.split(",").map((token) => token.trim().toLowerCase());
	return named.includes("accept-encoding") ? raw : `${raw}, Accept-Encoding`;
}

/**
 * The response a client that sent `accept` gets, with `method` deciding one thing only:
 * a `HEAD` is served the headers of the body it would have had, and not the body.
 *
 * A response that streams (`filePath`, `stream`) is returned untouched: a file is not
 * buffered here, and an event stream never ends. So is one that already names an
 * encoding, because a second encode is a bug the caller has to see rather than one this
 * hides.
 *
 * `Vary: Accept-Encoding` is written on the uncompressed answer too. The representation
 * *is* negotiable for a compressible type even when this request got identity — a small
 * body, or a client that did not ask — and a cache that saw only the plain variant would
 * otherwise replay it to a client that asked for gzip.
 */
export function settle(result: ServeResponse, accept: HeaderValue, method: string | undefined): ServeResponse {
	if (result.filePath !== undefined || result.stream === true) return result;
	if (result.body === undefined) return result;
	if (result.headers["Content-Encoding"] !== undefined) return result;
	if (!COMPRESSIBLE_TYPES.includes(mediaType(result.headers["Content-Type"]) ?? "")) return result;

	const body = typeof result.body === "string" ? Buffer.from(result.body, "utf-8") : result.body;
	const headers = { ...result.headers, Vary: varyWith(result.headers.Vary) };
	if (body.length < MIN_COMPRESS_BYTES || !acceptsGzip(accept)) return { ...result, headers };

	// The length and the acceptance decide the headers, which is what lets a HEAD name the
	// body it would have sent and stop there: only the bytes are the GET's, not the decision.
	const labelled = { ...headers, "Content-Encoding": CONTENT_ENCODING };
	if ((method ?? "GET").toUpperCase() === "HEAD") return { ...result, headers: labelled };
	return { ...result, body: gzipSync(body, { level: 6 }), headers: labelled };
}
