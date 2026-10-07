/**
 * Search pipeline: DuckDuckGo Instant Answer first, Wikipedia as a fallback.
 *
 * Both backends are keyless and fetch-only. Instant answers cover facts,
 * definitions, and calculations; Wikipedia covers topic queries. Neither is a
 * general web search, so the tool points the model at `web_fetch` for pages.
 */

import type { WebSearchConfig } from "./config.ts";
import { createFetchRunner, type HttpRunner } from "./http.ts";
import { searchInstantAnswer, type InstantAnswer } from "./instant-answer.ts";
import type { SearchProvider, SearchRequest, SearchResult } from "./types.ts";
import { searchWikipedia, wikipediaLangFor } from "./wikipedia.ts";

/** Error type for anything the model should see as a failed search. */
export class WebSearchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebSearchError";
	}
}

export interface SearchOutcome {
	provider: SearchProvider;
	answer: string;
	results: SearchResult[];
}

export interface SearchDeps {
	http?: HttpRunner;
}

let lastRequestAt = 0;
let runnerOverride: HttpRunner | undefined;

/** Reset the politeness throttle (tests only). */
export function resetThrottle(): void {
	lastRequestAt = 0;
}

/** Override the default HTTP runner (tests only). Pass undefined to clear. */
export function setDefaultRunnerForTests(runner: HttpRunner | undefined): void {
	runnerOverride = runner;
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

function instantAnswerText(instant: InstantAnswer): string {
	if (!instant.answer) return "";
	if (instant.source && instant.url) return `${instant.answer} — ${instant.source} (${instant.url})`;
	if (instant.url) return `${instant.answer} (${instant.url})`;
	return instant.answer;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Run one search. Throws `WebSearchError` when every backend that could answer
 * fails; an outcome with provider `"none"` means the query simply had no answer.
 */
export async function runSearch(
	request: SearchRequest,
	config: WebSearchConfig,
	signal: AbortSignal | undefined,
	deps: SearchDeps = {},
): Promise<SearchOutcome> {
	const http = deps.http ?? runnerOverride ?? createFetchRunner();

	await throttle(config.minIntervalMs, signal);
	let instant: InstantAnswer | undefined;
	let instantError: unknown;
	try {
		instant = await searchInstantAnswer(
			request.query,
			config.instantAnswerEndpoint,
			http,
			signal,
			config.timeoutMs,
			config.maxBytes,
		);
	} catch (error) {
		instantError = error;
	}

	if (instant && (instant.answer || instant.results.length > 0)) {
		return {
			provider: "duckduckgo",
			answer: instantAnswerText(instant),
			results: instant.results.slice(0, request.maxResults),
		};
	}

	await throttle(config.minIntervalMs, signal);
	let wikiError: unknown;
	try {
		const lang = wikipediaLangFor(request.query, config.wikipediaLang);
		const results = await searchWikipedia(request.query, lang, request.maxResults, config.wikipediaEndpoint, http, signal, {
			timeoutMs: config.timeoutMs,
			maxBytes: config.maxBytes,
			userAgent: config.userAgent,
		});
		if (results.length > 0) return { provider: "wikipedia", answer: "", results };
	} catch (error) {
		wikiError = error;
	}

	if (instantError && wikiError) {
		throw new WebSearchError(`Search failed. Instant answer: ${describe(instantError)} Wikipedia: ${describe(wikiError)}`);
	}
	if (instantError) throw new WebSearchError(`Search failed: ${describe(instantError)}`);

	return { provider: "none", answer: "", results: [] };
}
