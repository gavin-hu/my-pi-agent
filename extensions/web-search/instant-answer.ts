/**
 * DuckDuckGo Instant Answer API client.
 *
 * `https://api.duckduckgo.com/?q=…&format=json` is keyless, CORS-friendly, and
 * fetch-only. It returns instant answers (abstracts, definitions, calculations)
 * and *related topics*, not general web results, so it is the fast path and
 * Wikipedia is the fallback. Parsing is pure and defensive: the API returns
 * loosely-typed JSON with nested topic groups.
 */

import { HttpUnavailableError } from "../_shared/http.ts";
import type { HttpRunner } from "../_shared/http.ts";
import { asRecord, asString } from "./json.ts";
import type { SearchResult } from "./types.ts";

export interface InstantAnswer {
	/** Best available answer text (Answer, then AbstractText, then Definition). */
	answer: string;
	/** Source label for the answer, when known. */
	source: string;
	/** Source URL for the answer, when known. */
	url: string;
	results: SearchResult[];
}

function topicResult(raw: unknown): SearchResult | undefined {
	const topic = asRecord(raw);
	const url = asString(topic.FirstURL);
	const text = asString(topic.Text);
	if (!url || !text) return undefined;
	const separator = text.indexOf(" - ");
	const title = separator > 0 ? text.slice(0, separator).trim() : text;
	return { title: title.slice(0, 200), url, snippet: text };
}

/** Flatten `Results` and `RelatedTopics` (which can nest `Topics` groups). */
function collectTopics(value: unknown): SearchResult[] {
	if (!Array.isArray(value)) return [];
	const results: SearchResult[] = [];
	for (const entry of value) {
		const record = asRecord(entry);
		if (Array.isArray(record.Topics)) {
			results.push(...collectTopics(record.Topics));
			continue;
		}
		const result = topicResult(entry);
		if (result) results.push(result);
	}
	return results;
}

/** Turn an Instant Answer response into an answer plus de-duplicated topics. */
export function parseInstantAnswer(json: unknown): InstantAnswer {
	const data = asRecord(json);

	const answerCandidates: Array<[string, string, string]> = [
		[asString(data.Answer), asString(data.AnswerType), ""],
		[asString(data.AbstractText), asString(data.AbstractSource), asString(data.AbstractURL)],
		[asString(data.Definition), asString(data.DefinitionSource), asString(data.DefinitionURL)],
	];
	const chosen = answerCandidates.find(([text]) => text.length > 0);
	const answer = chosen?.[0] ?? "";
	const source = chosen?.[1] ?? "";
	const url = chosen?.[2] ?? "";

	const seen = new Set<string>();
	const results: SearchResult[] = [];
	for (const result of [...collectTopics(data.Results), ...collectTopics(data.RelatedTopics)]) {
		if (seen.has(result.url)) continue;
		seen.add(result.url);
		results.push(result);
	}

	return { answer, source, url, results };
}

/**
 * Query the Instant Answer API, returning `undefined` when the API has nothing
 * useful (no answer and no topics).
 */
export async function searchInstantAnswer(
	query: string,
	endpoint: string,
	http: HttpRunner,
	signal: AbortSignal | undefined,
	timeoutMs: number,
	maxBytes: number,
): Promise<InstantAnswer | undefined> {
	const url = new URL(endpoint);
	url.searchParams.set("q", query);
	url.searchParams.set("format", "json");
	url.searchParams.set("no_html", "1");
	url.searchParams.set("no_redirect", "1");
	url.searchParams.set("skip_disambig", "1");
	url.searchParams.set("t", "my-pi-agent");

	const response = await http(
		{ url: url.toString(), method: "GET", headers: { Accept: "application/json" }, timeoutMs, maxBytes },
		signal,
	);
	if (response.status < 200 || response.status >= 300) {
		throw new HttpUnavailableError(`DuckDuckGo Instant Answer returned HTTP ${response.status}.`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(response.body);
	} catch {
		throw new HttpUnavailableError("DuckDuckGo Instant Answer returned invalid JSON.");
	}

	const instant = parseInstantAnswer(parsed);
	if (!instant.answer && instant.results.length === 0) return undefined;
	return instant;
}
