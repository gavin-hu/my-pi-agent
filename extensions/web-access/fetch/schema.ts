/**
 * Parameter schema, output schema, and request resolution for `web_fetch`.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { MAX_OUTPUT_CHARS, type WebFetchConfig } from "./config.ts";
import type { FindMode } from "./find.ts";
import type { FetchRequest } from "./types.ts";

const MAX_URL_LENGTH = 2048;
export const MAX_URLS = 5;
export const MIN_CHARS = 200;

const FIND_MODES = ["insensitive", "exact", "fuzzy"] as const;
const DEFAULT_CONTEXT_CHARS = 200;
const DEFAULT_MAX_MATCHES = 8;
const MAX_FIND_TERMS = 10;

const HTTP_METHODS = ["GET", "POST"] as const;
const MAX_HEADERS = 20;
const MAX_HEADER_VALUE = 4096;
/** Headers that control the transport; letting the model set them would break framing or SSRF checks. */
const BLOCKED_HEADERS = new Set([
	"host",
	"content-length",
	"connection",
	"transfer-encoding",
	"upgrade",
	"te",
	"trailer",
	"proxy-connection",
	"proxy-authenticate",
	"proxy-authorization",
]);
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/;

export const WebFetchParams = Type.Object({
	url: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: MAX_URL_LENGTH,
			description: "Absolute http(s) URL to fetch. Provide either `url` or `urls`.",
		}),
	),
	urls: Type.Optional(
		Type.Array(Type.String({ maxLength: MAX_URL_LENGTH }), {
			minItems: 1,
			maxItems: MAX_URLS,
			description: `Up to ${MAX_URLS} URLs to fetch in one call (sequentially). Each is returned as its own page; failures do not abort the others.`,
		}),
	),
	method: Type.Optional(
		StringEnum(HTTP_METHODS, {
			description: 'HTTP method: "GET" (default) or "POST". POST is for read-style APIs such as GraphQL.',
		}),
	),
	headers: Type.Optional(
		Type.Record(Type.String(), Type.String(), {
			description: "Extra request headers, for example an API token or Accept type. Transport headers are refused.",
		}),
	),
	body: Type.Optional(
		Type.String({
			maxLength: 1_000_000,
			description: "Request body for a POST. Defaults method to POST; set Content-Type via `headers`.",
		}),
	),
	render: Type.Optional(
		Type.Boolean({
			description: "Force or forbid JS rendering for this call, overriding the renderJs config.",
		}),
	),
	startIndex: Type.Optional(
		Type.Integer({
			minimum: 0,
			description: "Code-point offset to start from. Use this to read a truncated page in chunks.",
		}),
	),
	maxChars: Type.Optional(
		Type.Integer({
			minimum: MIN_CHARS,
			maximum: MAX_OUTPUT_CHARS,
			description: "Maximum characters to return (default and ceiling: the configured maxOutputChars).",
		}),
	),
	find: Type.Optional(
		Type.Array(Type.String(), {
			minItems: 1,
			maxItems: MAX_FIND_TERMS,
			description:
				"Return passages matching these strings instead of the page text. Offsets are code points, usable as startIndex.",
		}),
	),
	mode: Type.Optional(StringEnum(FIND_MODES, { description: "Match mode for `find`. Defaults to insensitive." })),
	contextChars: Type.Optional(
		Type.Integer({
			minimum: 0,
			maximum: 2000,
			description: "Characters of context around each find match (default 200).",
		}),
	),
	maxMatches: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 50, description: "Maximum find matches to return (default 8)." }),
	),
	refresh: Type.Optional(Type.Boolean({ description: "Bypass the page cache and refetch." })),
});

export type WebFetchArgs = Static<typeof WebFetchParams>;

const PageSchema = Type.Object({
	url: Type.String(),
	finalUrl: Type.String(),
	title: Type.String(),
	status: Type.Number(),
	contentType: Type.String(),
	text: Type.String(),
	totalChars: Type.Number(),
	startIndex: Type.Number(),
	nextIndex: Type.Number(),
	truncated: Type.Boolean(),
	cached: Type.Boolean(),
	rendered: Type.Boolean(),
	matches: Type.Array(Type.Object({ query: Type.String(), offset: Type.Number(), passage: Type.String() })),
	matchesTruncated: Type.Boolean(),
	fetchedAt: Type.String(),
	error: Type.String(),
});

export const WebFetchOutput = Type.Object({
	pages: Type.Array(PageSchema),
});

/** The output shape, derived from the runtime schema so the two cannot drift. */
export type FetchResponse = Static<typeof PageSchema>;
export type FetchBatch = Static<typeof WebFetchOutput>;

function normalizeFind(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.trim())
		.filter(Boolean)
		.slice(0, MAX_FIND_TERMS);
}

/** Normalize custom headers: reject transport/control headers and CRLF, cap count and size. */
function normalizeHeaders(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const entries = Object.entries(raw as Record<string, unknown>);
	const headers: Record<string, string> = {};
	let count = 0;
	for (const [rawName, rawValue] of entries) {
		if (typeof rawValue !== "string") continue;
		const name = rawName.trim();
		if (!name) continue;
		if (!HEADER_NAME.test(name)) throw new Error(`header name "${name}" is invalid.`);
		if (BLOCKED_HEADERS.has(name.toLowerCase())) throw new Error(`header "${name}" is not allowed.`);
		if (/[\r\n]/.test(rawValue)) throw new Error(`header "${name}" contains an invalid character.`);
		const value = rawValue.trim();
		if (!value) continue;
		if (value.length > MAX_HEADER_VALUE) throw new Error(`header "${name}" is too long.`);
		if (count >= MAX_HEADERS) throw new Error(`at most ${MAX_HEADERS} headers are allowed.`);
		headers[name] = value;
		count++;
	}
	return headers;
}

/** Validate the arguments and clamp the optional fields. */
export function resolveRequest(args: WebFetchArgs, config: WebFetchConfig): FetchRequest {
	const single = typeof args.url === "string" ? args.url.trim() : "";
	const list = Array.isArray(args.urls)
		? args.urls
				.filter((value): value is string => typeof value === "string")
				.map((value) => value.trim())
				.filter(Boolean)
		: [];

	if (single && list.length > 0) throw new Error("provide either url or urls, not both.");
	const candidates = single ? [single] : list;
	if (candidates.length === 0) throw new Error("url is required.");
	if (candidates.length > MAX_URLS) throw new Error(`At most ${MAX_URLS} urls are allowed.`);
	if (candidates.some((value) => value.length > MAX_URL_LENGTH)) {
		throw new Error(`each url must be at most ${MAX_URL_LENGTH} characters.`);
	}

	const seen = new Set<string>();
	const urls: string[] = [];
	for (const candidate of candidates) {
		if (seen.has(candidate)) continue;
		seen.add(candidate);
		urls.push(candidate);
	}

	const explicitMethod = args.method === "GET" || args.method === "POST" ? args.method : undefined;
	if (args.body !== undefined && explicitMethod === "GET") throw new Error('body requires method "POST".');
	const method: "GET" | "POST" = explicitMethod ?? (args.body !== undefined ? "POST" : "GET");

	if (typeof args.body === "string" && args.body.length > config.maxBodyChars) {
		throw new Error(`body is longer than ${config.maxBodyChars} characters.`);
	}
	const headers = normalizeHeaders(args.headers);
	const body = typeof args.body === "string" ? args.body : undefined;

	const startIndex = typeof args.startIndex === "number" ? Math.max(0, Math.round(args.startIndex)) : 0;
	const requested = typeof args.maxChars === "number" ? args.maxChars : config.maxOutputChars;
	const maxChars = Math.min(config.maxOutputChars, Math.max(MIN_CHARS, Math.round(requested)));

	const rawMode = typeof args.mode === "string" ? args.mode : "";
	const mode: FindMode = (FIND_MODES as readonly string[]).includes(rawMode) ? (rawMode as FindMode) : "insensitive";

	const contextChars =
		typeof args.contextChars === "number"
			? Math.min(2000, Math.max(0, Math.round(args.contextChars)))
			: DEFAULT_CONTEXT_CHARS;
	const maxMatches =
		typeof args.maxMatches === "number" ? Math.min(50, Math.max(1, Math.round(args.maxMatches))) : DEFAULT_MAX_MATCHES;

	return {
		urls,
		method,
		headers,
		body,
		render: typeof args.render === "boolean" ? args.render : undefined,
		startIndex,
		maxChars,
		find: normalizeFind(args.find),
		mode,
		contextChars,
		maxMatches,
		refresh: args.refresh === true,
		cacheable: method === "GET" && Object.keys(headers).length === 0 && body === undefined,
	};
}
