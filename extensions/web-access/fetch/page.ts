/**
 * Fetch a URL and turn it into readable text.
 *
 * Validates the target and every redirect hop (SSRF guard), performs a
 * native-fetch request with an optional method/body/headers, and routes by
 * content type: HTML through the readable extractor, PDFs through the optional
 * text extractor, other textual types as-is, and binary types as a short note.
 * The HTTP runner and the PDF extractor are injectable through `FetchDeps`, so
 * no module-level state is needed.
 */

import type { WebFetchConfig } from "./config.ts";
import { extractReadable } from "./extract.ts";
import { extractPdfText, type PdfExtractor } from "./pdf.ts";
import { createFetchRunner, type HttpRunner, type HttpResponse } from "../http.ts";
import { assertAllowedUrl } from "./ssrf.ts";
import type { FetchRequest } from "./types.ts";

export class WebFetchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebFetchError";
	}
}

export interface FetchDeps {
	http?: HttpRunner;
	pdf?: PdfExtractor;
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

function isPdfType(contentType: string): boolean {
	return /pdf/i.test(contentType);
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch `target`, following redirects manually so every hop is re-validated by
 * the SSRF guard. A shared deadline keeps redirects from multiplying the
 * timeout. 301/302/303 switch a POST to a bodyless GET, as the Fetch spec does.
 */
async function fetchWithRedirects(
	target: URL,
	request: FetchRequest,
	config: WebFetchConfig,
	http: HttpRunner,
	signal: AbortSignal | undefined,
): Promise<HttpResponse> {
	const deadline = Date.now() + config.timeoutMs;
	let current = target.toString();
	let method: "GET" | "POST" = request.method;
	let body = request.body;

	for (let hop = 0; hop <= config.maxRedirects; hop++) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new WebFetchError(`Request timed out after ${config.timeoutMs}ms.`);

		const response = await http(
			{
				url: current,
				method,
				headers: request.headers,
				body,
				redirect: "manual",
				timeoutMs: remaining,
				maxBytes: config.maxBytes,
			},
			signal,
		);

		if (!REDIRECT_STATUS.has(response.status) || !response.location) return response;

		const next = await assertAllowedUrl(new URL(response.location, current).toString(), config.allowPrivateHosts);
		current = next.toString();

		if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
			method = "GET";
			body = undefined;
		}
	}

	throw new WebFetchError(`Too many redirects (more than ${config.maxRedirects}).`);
}

/** Fetch `url` and return its extracted text. Throws `WebFetchError`/`SsrfError`/`Http*Error`. */
export async function runFetch(
	url: string,
	request: FetchRequest,
	config: WebFetchConfig,
	signal: AbortSignal | undefined,
	deps: FetchDeps = {},
): Promise<PageResult> {
	const target = await assertAllowedUrl(url, config.allowPrivateHosts);
	const http = deps.http ?? createFetchRunner();

	const headers: Record<string, string> = {
		"User-Agent": config.userAgent,
		Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
		"Accept-Language": config.acceptLanguage,
		...request.headers,
	};

	const response = await fetchWithRedirects(target, { ...request, headers }, config, http, signal);

	if (response.status >= 400) {
		throw new WebFetchError(`HTTP ${response.status} for ${response.finalUrl}.`);
	}

	let title = "";
	let text: string;
	if (isPdfType(response.contentType) && config.pdfEnabled) {
		try {
			text = await extractPdfText(response.bytes ?? new Uint8Array(), deps.pdf);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			text = `(binary content: ${response.contentType || "application/pdf"}, ${response.sizeBytes} bytes; PDF text extraction failed: ${reason})`;
		}
	} else if (isHtmlType(response.contentType)) {
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
