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
import {
	errorLine,
	elapsedSuffix,
	rejectionLine,
	reuseCallText,
	startToolProgress,
	syncElapsedTimer,
	toolCallTitle,
} from "../../../lib/tui/tool.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { SEPARATORS } from "../../../lib/tui/glyphs.ts";
import { charLength } from "../text.ts";
import { oneLine } from "../transcript.ts";
import { createPageCache, type PageCache } from "./cache.ts";
import type { WebFetchConfig } from "./config.ts";
import { findPassages, type Passage } from "./find.ts";
import { formatMatches, formatPage } from "./format.ts";
import { runFetch, type FetchDeps, type PageResult } from "./page.ts";
import { resolveRequest, WebFetchOutput, WebFetchParams, type FetchResponse, type WebFetchArgs } from "./schema.ts";
import type { FetchRequest } from "./types.ts";
import { loadFetchConfig } from "../config.ts";

export const TOOL_NAME = "web_fetch";

/** The host shown while a fetch is in flight, or `page` for an unparseable URL. */
function hostOf(raw: string | undefined): string {
	try {
		return new URL(raw ?? "").hostname || "page";
	} catch {
		return "page";
	}
}

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

	let formatted: { body: string; text: string; truncated: boolean };
	let nextIndex: number;
	let matches: Passage[] = [];
	let matchesTruncated = false;

	if (finding) {
		// Request one extra so a full list proves more hits exist; only the cap is shown.
		const found = findPassages(page.text, request.find, {
			mode: request.mode,
			contextChars: request.contextChars,
			maxMatches: request.maxMatches + 1,
		});
		const cappedByMaxMatches = found.length > request.maxMatches;
		const rendered = formatMatches({
			finalUrl: page.finalUrl,
			title: page.title,
			status: page.status,
			contentType: page.contentType,
			matches: cappedByMaxMatches ? found.slice(0, request.maxMatches) : found,
			find: request.find,
			maxChars: request.maxChars,
			cappedByMaxMatches,
		});
		formatted = rendered;
		matches = rendered.included;
		matchesTruncated = rendered.truncated;
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
		matches,
		matchesTruncated,
		fetchedAt,
		error: "",
	};
	return { response, text: formatted.text };
}

/** Build the response entry and text for a failed URL. */
function fetchErrorResult(
	url: string,
	request: FetchRequest,
	message: string,
): { response: FetchResponse; text: string } {
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
		annotations: { readOnlyHint: true, openWorldHint: true },

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const config = loadFetchConfig(ctx.cwd);
			const request = resolveRequest(params as WebFetchArgs, config);
			startToolProgress(onUpdate);

			let page: FetchResponse;
			let text: string;
			try {
				const loaded = await loadPage(request.url, request, config, signal, fetchDeps, cache);
				({ response: page, text } = pageResult(loaded, request));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				({ response: page, text } = fetchErrorResult(request.url, request, message));
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
			const text = reuseCallText(context?.lastComponent, "", "middle");
			let line = toolCallTitle(theme, `${TOOL_NAME} `) + paint(theme, "label", oneLine(url ?? ""));
			if (find?.length) line += paint(theme, "faint", ` find ${find.map((f) => `"${oneLine(f)}"`).join(", ")}`);
			else if (startIndex) line += paint(theme, "faint", ` (from ${startIndex})`);
			text.setText(line);
			return text;
		},

		renderResult(result, options, theme, context) {
			const startedAt = syncElapsedTimer(options.isPartial, context);
			const text = reuseText(context?.lastComponent);
			const page = result.details as FetchResponse | undefined;
			if (options.isPartial) {
				const elapsed = startedAt === undefined ? "" : elapsedSuffix(theme, Date.now() - startedAt);
				text.setText(paint(theme, "warn", `Fetching ${hostOf((context.args as WebFetchArgs)?.url)}…`) + elapsed);
				return text;
			}
			if (page?.error) {
				text.setText(errorLine(theme, page.error));
				return text;
			}
			if (!page || result.isError) {
				text.setText(rejectionLine(theme, result, options.expanded));
				return text;
			}

			const label = oneLine(page.title || page.finalUrl);
			let line = paint(theme, "meta", label);
			line += paint(theme, "faint", `${SEPARATORS.item}${page.status}`);
			if (page.finalUrl !== page.url) line += paint(theme, "faint", `${SEPARATORS.item}→ ${oneLine(page.finalUrl)}`);
			if (page.matches.length > 0) line += paint(theme, "faint", `${SEPARATORS.item}${page.matches.length} match(es)`);
			else line += paint(theme, "faint", `${SEPARATORS.item}${formatTokens(page.totalChars)} chars`);
			if (page.cached) line += paint(theme, "faint", " (cached)");
			line += elapsedSuffix(theme, context.durationMs);
			text.setText(line);
			return text;
		},
	});
}
