/**
 * The `web_fetch` tool.
 *
 * A native-fetch GET/POST with HTML turned into readable Markdown-ish text,
 * optional PDF text extraction, `startIndex`/`maxChars` paging, and
 * `find` for passage search. Redirects are followed with every hop
 * SSRF-checked, and pages are cached in an instance created per registration
 * and cleared on `session_start`/`session_shutdown`; the `fetch` section of
 * `bytefly.json` (the `web-access.fetch` section) configures it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatTokens } from "../../../lib/format.ts";
import { reuseText } from "../../../lib/tui/chrome.ts";
import { SEPARATORS } from "../../../lib/tui/glyphs.ts";
import { charLength } from "../text.ts";
import { oneLine } from "../transcript.ts";
import { createPageCache, type PageCache } from "./cache.ts";
import type { WebFetchConfig } from "./config.ts";
import { findPassages } from "./find.ts";
import { formatMatches, formatPage } from "./format.ts";
import { runFetch, type FetchDeps, type PageResult } from "./page.ts";
import { resolveRequest, WebFetchOutput, WebFetchParams, type FetchResponse, type WebFetchArgs } from "./schema.ts";
import type { FetchRequest } from "./types.ts";
import { loadFetchConfig } from "../config.ts";

export const TOOL_NAME = "web_fetch";

/** Extra `web_fetch` dependencies: the shared `FetchDeps` plus the page cache. */
interface FetchToolDeps extends FetchDeps {
	cache?: PageCache;
}

interface LoadedPage {
	page: PageResult;
	cached: boolean;
	fetchedAt: string;
}

/** Fetch one URL, serving from and populating the page cache when allowed. */
async function loadPage(
	url: string,
	request: FetchRequest,
	config: WebFetchConfig,
	signal: AbortSignal | undefined,
	deps: FetchDeps,
	cache: PageCache,
): Promise<LoadedPage> {
	const cacheable = config.cacheEnabled && request.cacheable && !request.refresh;
	const cachedEntry = cacheable ? cache.get(url, config.cacheTtlMs) : undefined;
	if (cachedEntry) return { page: cachedEntry, cached: true, fetchedAt: cachedEntry.fetchedAt };

	const page = await runFetch(url, request, config, signal, deps);
	const fetchedAt = new Date().toISOString();
	if (config.cacheEnabled && request.cacheable) {
		cache.set(
			url,
			{ ...page, fetchedAt, storedAt: Date.now(), bytes: new TextEncoder().encode(page.text).length },
			{ maxEntries: config.cacheMaxEntries, maxBytes: config.cacheMaxBytes },
		);
	}
	return { page, cached: false, fetchedAt };
}

/** Build the response entry and model-facing text for one fetched page. */
function pageResult(loaded: LoadedPage, request: FetchRequest): { response: FetchResponse; text: string } {
	const { page, cached, fetchedAt } = loaded;
	const finding = request.find.length > 0;
	const matches = finding
		? findPassages(page.text, request.find, {
				mode: request.mode,
				contextChars: request.contextChars,
				maxMatches: request.maxMatches + 1,
			})
		: [];
	// Request one extra so a full list proves more hits exist; only the cap is shown.
	const matchesTruncated = finding && matches.length > request.maxMatches;
	const visibleMatches = matchesTruncated ? matches.slice(0, request.maxMatches) : matches;

	let formatted: { body: string; text: string; truncated: boolean };
	let nextIndex: number;
	if (finding) {
		formatted = formatMatches({
			finalUrl: page.finalUrl,
			title: page.title,
			status: page.status,
			contentType: page.contentType,
			matches: visibleMatches,
			find: request.find,
			truncated: matchesTruncated,
		});
		// Find results are not paged, so the caller keeps reading from the same offset.
		nextIndex = request.startIndex;
	} else {
		const paged = formatPage({
			finalUrl: page.finalUrl,
			title: page.title,
			status: page.status,
			contentType: page.contentType,
			text: page.text,
			startIndex: request.startIndex,
			maxChars: request.maxChars,
		});
		formatted = paged;
		nextIndex = paged.nextIndex;
	}

	const response: FetchResponse = {
		url: page.url,
		finalUrl: page.finalUrl,
		title: page.title,
		status: page.status,
		contentType: page.contentType,
		text: formatted.body,
		totalChars: charLength(page.text),
		startIndex: request.startIndex,
		nextIndex,
		truncated: formatted.truncated,
		cached,
		matches: visibleMatches,
		matchesTruncated,
		fetchedAt,
		error: "",
	};
	return { response, text: formatted.text };
}

/** Build the response entry and text for a failed URL. */
function errorResult(url: string, request: FetchRequest, message: string): { response: FetchResponse; text: string } {
	return {
		response: {
			url,
			finalUrl: url,
			title: "",
			status: 0,
			contentType: "",
			text: "",
			totalChars: 0,
			startIndex: request.startIndex,
			nextIndex: request.startIndex,
			truncated: false,
			cached: false,
			matches: [],
			matchesTruncated: false,
			fetchedAt: new Date().toISOString(),
			error: message,
		},
		text: `ERROR: ${message}`,
	};
}

export function registerFetchTool(pi: ExtensionAPI, deps: FetchToolDeps = {}): void {
	const { cache: injectedCache, ...fetchDeps } = deps;
	const cache = injectedCache ?? createPageCache();
	// One cache per registration: clear on start and shutdown so no page outlives a session.
	const clearCache = () => cache.clear();
	pi.on("session_start", clearCache);
	pi.on("session_shutdown", clearCache);

	pi.registerTool({
		name: TOOL_NAME,
		label: "Web fetch",
		description:
			"Fetch a URL and return readable text (HTML converted with links preserved; PDFs text-extracted " +
			"when unpdf is installed). Supports GET/POST, paging, and `find`. Every redirect hop is checked against " +
			"private/internal addresses, which are refused.",
		promptSnippet: "Fetch URLs and read their page text; optionally find passages.",
		promptGuidelines: [
			"Use web_fetch for a URL's full content, not just a snippet.",
			"Pass `find` to locate specific passages cheaply, then use startIndex to read around a hit.",
			"When truncated, call again with the suggested startIndex.",
		],
		parameters: WebFetchParams,
		outputSchema: WebFetchOutput,
		exposure: "direct",
		defaultActive: true,
		annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
		// The page cache is shared in-memory state created per registration, so
		// sibling calls must not run concurrently (matches web_search's throttle).
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const config = loadFetchConfig(ctx.cwd);
			const request = resolveRequest(params as WebFetchArgs, config);

			let page: FetchResponse;
			let text: string;
			try {
				const loaded = await loadPage(request.url, request, config, signal, fetchDeps, cache);
				({ response: page, text } = pageResult(loaded, request));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				({ response: page, text } = errorResult(request.url, request, message));
			}

			return {
				content: [{ type: "text", text }],
				details: page,
				structuredContent: page,
				isError: page.error ? true : undefined,
			};
		},

		renderCall(args, theme, context) {
			const { url, find, startIndex } = args as WebFetchArgs;
			const text = reuseText(context?.lastComponent);
			let line = theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) + theme.fg("accent", oneLine(url ?? ""));
			if (find?.length) line += theme.fg("dim", ` find ${find.map((f) => `"${oneLine(f)}"`).join(", ")}`);
			else if (startIndex) line += theme.fg("dim", ` (from ${startIndex})`);
			text.setText(line);
			return text;
		},

		renderResult(result, _options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const page = result.details as FetchResponse | undefined;
			if (page?.error) {
				const message = oneLine(page.error);
				text.setText(theme.fg("error", message.startsWith("Error:") ? message : `Error: ${message}`));
				return text;
			}
			if (!page || result.isError) {
				const first = result.content[0];
				const message = oneLine(first?.type === "text" ? first.text : "Fetch failed");
				text.setText(theme.fg("error", message.startsWith("Error:") ? message : `Error: ${message}`));
				return text;
			}

			const label = oneLine(page.title || page.finalUrl);
			let line = theme.fg("muted", label);
			if (page.matches.length > 0) line += theme.fg("dim", `${SEPARATORS.item}${page.matches.length} match(es)`);
			else line += theme.fg("dim", `${SEPARATORS.item}${formatTokens(page.totalChars)} chars`);
			if (page.cached) line += theme.fg("dim", " (cached)");
			text.setText(line);
			return text;
		},
	});
}
