/**
 * Search orchestration: resolve one provider, throttle, run, map the outcome.
 *
 * The orchestrator owns everything shared across providers — selection, key
 * resolution, politeness spacing, and turning provider errors into a
 * model-readable `WebSearchError`. Providers stay pure. The throttle is a value
 * object created per extension instance, so there is no module-level state.
 */

import { createFetchRunner, type HttpRunner } from "../http.ts";
import { resolveSearchApiKey, type WebSearchConfig } from "./config.ts";
import { resolveProvider } from "./registry.ts";
import type { SearchProviderId, SearchProviderName, SearchRequest, SearchResult } from "./types.ts";

/** Error type for anything the model should see as a failed search. */
export class WebSearchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebSearchError";
	}
}

export interface SearchOutcome {
	provider: SearchProviderName;
	answer: string;
	results: SearchResult[];
}

/** A politeness throttle. Create one per extension instance, not per module. */
export interface Throttle {
	wait(minIntervalMs: number, signal?: AbortSignal): Promise<void>;
}

export interface SearchDeps {
	http?: HttpRunner;
	throttle?: Throttle;
}

/** A sleeper, injectable so throttle scheduling is testable without wall time. */
export type ThrottleSleep = (ms: number, signal?: AbortSignal) => Promise<void>;

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

/**
 * A stateful throttle that spaces requests by `minIntervalMs`. `now` and `sleep`
 * are injectable so tests can advance a fake clock instead of waiting.
 */
export function createThrottle(now: () => number = Date.now, sleep: ThrottleSleep = delay): Throttle {
	let nextAllowedAt = 0;
	return {
		async wait(minIntervalMs, signal) {
			if (minIntervalMs <= 0) return;
			const current = now();
			const wait = nextAllowedAt - current;
			nextAllowedAt = current + Math.max(0, wait) + minIntervalMs;
			if (wait > 0) await sleep(wait, signal);
		},
	};
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** A model-readable reason a forced provider cannot run. */
function notConfigured(id: SearchProviderId): string {
	if (id === "searxng") {
		return 'No SearXNG endpoint configured. Set "search.endpoint" in web-access.json (for example http://localhost:8080).';
	}
	if (id === "brave") {
		return 'Brave search needs an API key. Set "search.apiKeyEnv" (preferred) or "search.apiKey" in web-access.json.';
	}
	return `The "${id}" search provider is not configured.`;
}

/**
 * Run one search against the resolved provider. Throws `WebSearchError` when the
 * provider is unconfigured or the request fails; a `"none"` outcome means the
 * query simply had no results.
 */
export async function runSearch(
	request: SearchRequest,
	config: WebSearchConfig,
	signal: AbortSignal | undefined,
	deps: SearchDeps = {},
): Promise<SearchOutcome> {
	const provider = resolveProvider(config);
	if (!provider.isConfigured(config)) throw new WebSearchError(notConfigured(provider.id));

	const http = deps.http ?? createFetchRunner();
	const throttle = deps.throttle ?? createThrottle();
	await throttle.wait(config.minIntervalMs, signal);

	let result: { answer: string; results: SearchResult[] };
	try {
		result = await provider.search({
			request,
			config,
			http,
			signal,
			apiKey: resolveSearchApiKey(config),
		});
	} catch (error) {
		if (error instanceof WebSearchError) throw error;
		throw new WebSearchError(`Search failed: ${describe(error)}`);
	}

	if (!result.answer && result.results.length === 0) {
		return { provider: "none", answer: "", results: [] };
	}
	return { provider: provider.id, answer: result.answer, results: result.results };
}
