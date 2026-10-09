/**
 * Fetch a URL and turn it into readable text.
 *
 * Validates the target and every redirect hop (SSRF guard), performs a
 * native-fetch request with an optional method/body/headers, and routes by
 * content type: HTML through the readable extractor (optionally JS-rendered),
 * PDFs through the optional text extractor, other textual types as-is, and
 * binary types as a short note. `HttpRunner` is injectable for tests.
 */

import type { WebFetchConfig } from "./config.ts";
import { extractReadable, type ExtractedPage } from "./extract.ts";
import { extractPdfText } from "./pdf.ts";
import { renderPage } from "./render.ts";
import { createFetchRunner, type HttpRunner, type HttpResponse } from "../http.ts";
import { assertAllowedUrl } from "./ssrf.ts";
import type { FetchRequest } from "./types.ts";

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
	/** True when the page HTML came from the JS renderer. */
	rendered: boolean;
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

/**
 * Decide whether to render, then return the extracted page. The raw HTML is
 * extracted once; the rendered DOM is extracted only when rendering actually
 * runs. `"auto"` falls back to the raw page when rendering fails.
 */
async function resolveHtml(
	response: HttpResponse,
	request: FetchRequest,
	config: WebFetchConfig,
	signal: AbortSignal | undefined,
): Promise<{ page: ExtractedPage; rendered: boolean }> {
	const raw =
		request.render === undefined && config.renderJs === "auto"
			? extractReadable(response.body, response.finalUrl)
			: undefined;

	let should = request.render === true || config.renderJs === "always";
	if (request.render === false) should = false;
	if (raw) should = Array.from(raw.text).length < config.renderMinChars;
	if (!should) return { page: raw ?? extractReadable(response.body, response.finalUrl), rendered: false };

	try {
		const html = (
			await renderPage(response.finalUrl, {
				timeoutMs: config.renderTimeoutMs,
				waitUntil: config.renderWaitUntil,
				executablePath: config.renderExecutablePath,
				signal,
			})
		).html;
		return { page: extractReadable(html, response.finalUrl), rendered: true };
	} catch (error) {
		// For an explicit request or "always", surface the failure; "auto" degrades to raw HTML.
		if (request.render === true || config.renderJs === "always") throw error;
		return { page: raw ?? extractReadable(response.body, response.finalUrl), rendered: false };
	}
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
	const http = deps.http ?? runnerOverride ?? createFetchRunner();

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
	let rendered = false;
	if (isPdfType(response.contentType) && config.pdfEnabled) {
		try {
			text = await extractPdfText(response.bytes ?? new Uint8Array());
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			text = `(binary content: ${response.contentType || "application/pdf"}, ${response.sizeBytes} bytes; PDF text extraction failed: ${reason})`;
		}
	} else if (isHtmlType(response.contentType)) {
		const resolved = await resolveHtml(response, request, config, signal);
		title = resolved.page.title;
		text = resolved.page.text;
		rendered = resolved.rendered;
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
		rendered,
	};
}
