/**
 * Keyless DuckDuckGo search over the classic HTML endpoint.
 *
 * DuckDuckGo serves its "select all ducks" anti-bot challenge to Node/Bun fetch
 * clients but accepts the same POST from `curl`, so requests go through the curl
 * transport in `curl.ts` (verified to return organic results for English and
 * Chinese queries). A process-wide timestamp spaces requests out; the tool also
 * runs sequentially.
 */

import { DEFAULT_USER_AGENT, type WebSearchConfig } from "./config.ts";
import { createCurlPoster, type HttpPoster } from "./curl.ts";
import { isChallengePage, parseDuckDuckGoHtml } from "./parse.ts";
import type { SafeSearch, SearchRequest, SearchResult } from "./types.ts";

/** DuckDuckGo `kp` value per safe-search level. */
export const KP_BY_SAFE_SEARCH: Record<SafeSearch, string> = {
	strict: "1",
	moderate: "-1",
	off: "-2",
};

/** Error type for anything the model should see as a failed search. */
export class WebSearchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebSearchError";
	}
}

/** Injectable dependencies (used by tests to avoid the network and subprocesses). */
export interface SearchDeps {
	httpPost?: HttpPoster;
}

let lastRequestAt = 0;
let posterOverride: HttpPoster | undefined;

/** Reset the politeness throttle (tests only). */
export function resetThrottle(): void {
	lastRequestAt = 0;
}

/** Override the default HTTP poster (tests only). Pass undefined to clear. */
export function setDefaultHttpPosterForTests(poster: HttpPoster | undefined): void {
	posterOverride = poster;
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve, reject) => {
		const finish = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		const onAbort = () => {
			finish();
			reject(new WebSearchError("Search aborted."));
		};
		const timer = setTimeout(() => {
			finish();
			resolve();
		}, ms);
		if (signal?.aborted) return onAbort();
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function throttle(minIntervalMs: number, signal: AbortSignal | undefined): Promise<void> {
	if (minIntervalMs <= 0) return;
	const now = Date.now();
	const wait = lastRequestAt + minIntervalMs - now;
	lastRequestAt = now + Math.max(0, wait);
	if (wait > 0) await delay(wait, signal);
}

function toSearchError(error: unknown, signal: AbortSignal | undefined, timeoutMs: number): WebSearchError {
	if (error instanceof WebSearchError) return error;
	if (signal?.aborted) return new WebSearchError("Search aborted.");
	const name = error instanceof Error ? error.name : "";
	if (name === "CurlTimeoutError") return new WebSearchError(`Search timed out after ${timeoutMs}ms.`);
	if (name === "CurlAbortError") return new WebSearchError("Search aborted.");
	if (name === "CurlUnavailableError") {
		return new WebSearchError(error instanceof Error ? error.message : String(error));
	}
	const message = error instanceof Error ? error.message : String(error);
	return new WebSearchError(`Search request failed: ${message}`);
}

/**
 * Run one DuckDuckGo search and return up to `request.maxResults` results.
 *
 * Throws `WebSearchError` for transport failures, timeouts, non-2xx responses,
 * and anti-bot challenges; an empty array means the query genuinely had no hits.
 */
export async function searchDuckDuckGo(
	request: SearchRequest,
	config: WebSearchConfig,
	signal: AbortSignal | undefined,
	deps: SearchDeps = {},
): Promise<SearchResult[]> {
	const httpPost = deps.httpPost ?? posterOverride ?? createCurlPoster(config.curlPath);

	await throttle(config.minIntervalMs, signal);
	lastRequestAt = Date.now();

	let origin = "https://html.duckduckgo.com";
	try {
		origin = new URL(config.endpoint).origin;
	} catch {
		// keep the DuckDuckGo default; normalizeConfig already rejected bad URLs
	}

	try {
		const { status, body } = await httpPost(
			{
				url: config.endpoint,
				headers: {
					"User-Agent": config.userAgent ?? DEFAULT_USER_AGENT,
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					"Accept-Language": config.acceptLanguage,
					Referer: `${origin}/`,
				},
				form: {
					q: request.query,
					b: "",
					kl: request.region,
					kp: KP_BY_SAFE_SEARCH[request.safeSearch],
				},
				timeoutMs: config.timeoutMs,
			},
			signal,
		);

		if (isChallengePage(body)) {
			throw new WebSearchError(
				"DuckDuckGo returned its anti-bot challenge instead of results. Wait a few seconds and retry, or run from a different network.",
			);
		}
		if (status < 200 || status >= 300) {
			throw new WebSearchError(`DuckDuckGo returned HTTP ${status}.`);
		}

		return parseDuckDuckGoHtml(body, request.maxResults);
	} catch (error) {
		throw toSearchError(error, signal, config.timeoutMs);
	}
}
