/**
 * Fetch a URL and turn it into readable text.
 *
 * Validates the target (SSRF guard), performs a native-fetch GET, and routes by
 * content type: HTML through the readable extractor, other textual types as-is,
 * and binary types as a short note. `HttpRunner` is injectable for tests.
 */

import type { WebFetchConfig } from "./config.ts";
import { extractReadable } from "./extract.ts";
import { createFetchRunner, type HttpRunner } from "../_shared/http.ts";
import { assertAllowedUrl } from "./ssrf.ts";

class WebFetchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebFetchError";
	}
}

export interface FetchDeps {
	http?: HttpRunner;
}

let runnerOverride: HttpRunner | undefined;

/** Override the default HTTP runner (tests only). Pass undefined to clear. */
export function setDefaultRunnerForTests(runner: HttpRunner | undefined): void {
	runnerOverride = runner;
}

export interface PageResult {
	url: string;
	finalUrl: string;
	title: string;
	status: number;
	contentType: string;
	text: string;
}

function isHtmlType(contentType: string): boolean {
	return /html|xhtml/i.test(contentType);
}

function isTextualType(contentType: string): boolean {
	if (!contentType) return true;
	if (/^text\//i.test(contentType)) return true;
	return /(json|xml|javascript|ecmascript|x-ndjson)/i.test(contentType);
}

/** Fetch `url` and return its extracted text. Throws `WebFetchError`/`SsrfError`/`Http*Error`. */
export async function runFetch(
	url: string,
	config: WebFetchConfig,
	signal: AbortSignal | undefined,
	deps: FetchDeps = {},
): Promise<PageResult> {
	const target = await assertAllowedUrl(url, config.allowPrivateHosts);
	const http = deps.http ?? runnerOverride ?? createFetchRunner();

	const response = await http(
		{
			url: target.toString(),
			method: "GET",
			headers: {
				"User-Agent": config.userAgent,
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
				"Accept-Language": config.acceptLanguage,
			},
			timeoutMs: config.timeoutMs,
			maxBytes: config.maxBytes,
		},
		signal,
	);

	if (response.status >= 400) {
		throw new WebFetchError(`HTTP ${response.status} for ${response.finalUrl}.`);
	}

	let title = "";
	let text: string;
	if (isHtmlType(response.contentType)) {
		const page = extractReadable(response.body, response.finalUrl);
		title = page.title;
		text = page.text;
	} else if (isTextualType(response.contentType)) {
		text = response.body;
	} else {
		text = `(binary content: ${response.contentType || "unknown"}, ${response.sizeBytes} bytes; web_fetch returns text only)`;
	}

	return {
		url: target.toString(),
		finalUrl: response.finalUrl,
		title,
		status: response.status,
		contentType: response.contentType,
		text,
	};
}
