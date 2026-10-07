/**
 * Parameter schema, output schema, and request resolution for `web_fetch`.
 */

import { Type, type Static } from "typebox";
import type { WebFetchConfig } from "./config.ts";

export const MAX_URL_LENGTH = 2048;
export const MIN_CHARS = 200;
export const MAX_CHARS = 100_000;

export const WebFetchParams = Type.Object({
	url: Type.String({
		minLength: 1,
		maxLength: MAX_URL_LENGTH,
		description: "Absolute http(s) URL to fetch.",
	}),
	startIndex: Type.Optional(
		Type.Integer({
			minimum: 0,
			description: "Code-point offset to start from. Use this to read a truncated page in chunks.",
		}),
	),
	maxChars: Type.Optional(
		Type.Integer({
			minimum: MIN_CHARS,
			maximum: MAX_CHARS,
			description: `Maximum characters to return (default and ceiling: the configured maxOutputChars).`,
		}),
	),
});

export type WebFetchArgs = Static<typeof WebFetchParams>;

export const WebFetchOutput = Type.Object({
	url: Type.String(),
	finalUrl: Type.String(),
	title: Type.String(),
	status: Type.Number(),
	contentType: Type.String(),
	text: Type.String(),
	totalChars: Type.Number(),
	startIndex: Type.Number(),
	truncated: Type.Boolean(),
	fetchedAt: Type.String(),
});

export type WebFetchStructured = Static<typeof WebFetchOutput>;

export interface FetchRequest {
	url: string;
	startIndex: number;
	maxChars: number;
}

/** Validate the arguments and clamp `maxChars` to the configured ceiling. */
export function resolveRequest(args: WebFetchArgs, config: WebFetchConfig): FetchRequest {
	const url = typeof args.url === "string" ? args.url.trim() : "";
	if (!url) throw new Error("url is required.");
	if (url.length > MAX_URL_LENGTH) throw new Error(`url is longer than ${MAX_URL_LENGTH} characters.`);

	const startIndex = typeof args.startIndex === "number" ? Math.max(0, Math.round(args.startIndex)) : 0;
	const requested = typeof args.maxChars === "number" ? args.maxChars : config.maxOutputChars;
	const maxChars = Math.min(config.maxOutputChars, MAX_CHARS, Math.max(MIN_CHARS, Math.round(requested)));

	return { url, startIndex, maxChars };
}
