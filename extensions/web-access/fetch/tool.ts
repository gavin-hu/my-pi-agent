/**
 * The `web_fetch` tool.
 *
 * A native-fetch GET/POST with HTML turned into readable Markdown-ish text,
 * optional PDF text extraction and JS rendering, `startIndex`/`maxChars` paging,
 * `find` for passage search, and up to five URLs per call. Redirects are
 * followed with every hop SSRF-checked, and pages are cached in an instance
 * created per registration and cleared on `session_start`/`session_shutdown`;
 * the `fetch` section of `web-access.json` configures it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatTokens } from "../../../lib/format.ts";
import { charLength } from "../text.ts";
import { oneLine } from "../transcript.ts";
import { createPageCache, type PageCache } from "./cache.ts";
import type { WebFetchConfig } from "./config.ts";
import { findPassages } from "./find.ts";
import { formatBatch, formatMatches, formatPage, type BatchSection } from "./format.ts";
import { runFetch, type FetchDeps, type PageResult } from "./page.ts";
import {
	MIN_CHARS,
	resolveRequest,
	WebFetchOutput,
	WebFetchParams,
	type FetchBatch,
	type FetchResponse,
	type WebFetchArgs,
} from "./schema.ts";
import type { FetchRequest } from "./types.ts";
import { loadFetchConfig } from "../config.ts";

export const TOOL_NAME = "web_fetch";

/** Extra `web_fetch` dependencies: the shared `FetchDeps` plus the page cache. */
export interface FetchToolDeps extends FetchDeps {
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

/** Build the response entry and formatted section for one fetched page. */
function pageResult(
	url: string,
	loaded: LoadedPage,
	request: FetchRequest,
	perPageChars: number,
): { response: FetchResponse; section: BatchSection } {
	const { page, cached, fetchedAt } = loaded;
	const finding = request.find.length > 0;
	const matches = finding
		? findPassages(page.text, request.find, {
				mode: request.mode,
				contextChars: request.contextChars,
				maxMatches: request.maxMatches,
			})
		: [];
	// A full match list means the cap may have hidden further hits.
	const matchesTruncated = finding && matches.length >= request.maxMatches;

	let formatted: { body: string; text: string; truncated: boolean };
	let nextIndex: number;
	if (finding) {
		formatted = formatMatches({
			finalUrl: page.finalUrl,
			title: page.title,
			status: page.status,
			contentType: page.contentType,
			matches,
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
			maxChars: perPageChars,
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
		rendered: page.rendered,
		matches,
		matchesTruncated,
		fetchedAt,
		error: "",
	};
	return { response, section: { url, text: formatted.text } };
}

/** Build the response entry and section for a failed URL. */
function errorResult(
	url: string,
	request: FetchRequest,
	message: string,
): { response: FetchResponse; section: BatchSection } {
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
			rendered: false,
			matches: [],
			matchesTruncated: false,
			fetchedAt: new Date().toISOString(),
			error: message,
		},
		section: { url, text: `ERROR: ${message}` },
	};
}

/**
 * Split the output budget across the requested URLs. Each page's section is
 * sized to fit `perPageChars` including its header and truncation note, and the
 * per-section overhead (`### url` plus separators) is subtracted first, so the
 * joined batch stays inside `maxChars` and `formatBatch` never has to cut.
 */
function perPageBudget(request: FetchRequest): number {
	// Reserve room for a possible "(showing K of N pages)" notice on the joined text.
	const NOTICE_RESERVE = 32;
	const overhead = request.urls.reduce((sum, url) => sum + charLength(url) + 7, 0) + NOTICE_RESERVE;
	const available = Math.max(MIN_CHARS, request.maxChars - overhead);
	return Math.max(MIN_CHARS, Math.floor(available / request.urls.length));
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
			"Fetch one or more URLs and return their readable text (HTML is converted to plain text with links " +
			"preserved; PDFs are text-extracted when the optional unpdf package is installed). Use GET by default, or POST " +
			"with optional headers/body for read-style APIs. Long pages are paged: if the result says it was truncated, " +
			"call web_fetch again with the given startIndex. Pass `find` to get matching passages and their offsets " +
			"instead of the whole page. Provide `urls` to read up to five pages in one call; a failure on one URL does " +
			"not stop the others. Redirects are followed with every hop checked against private/internal addresses, " +
			"which are refused.",
		promptSnippet: "Fetch one or more URLs and read their page content as text; optionally find passages.",
		promptGuidelines: [
			"Use web_fetch when you have a URL or need a page's full content, not just a snippet.",
			"Use POST with `headers`/`body` for read-style APIs (for example GraphQL); set Content-Type in `headers`.",
			"Pass `find` to locate specific passages cheaply; then use startIndex to read around a hit.",
			"Fetch several candidate pages at once with `urls` to compare sources.",
			"When the result is truncated, call web_fetch again with the suggested startIndex.",
		],
		parameters: WebFetchParams,
		outputSchema: WebFetchOutput,
		exposure: "direct",
		defaultActive: true,
		annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const config = loadFetchConfig(ctx.cwd);
			const request = resolveRequest(params as WebFetchArgs, config);
			const perPageChars = perPageBudget(request);

			const pages: FetchResponse[] = [];
			const sections: BatchSection[] = [];

			for (const url of request.urls) {
				try {
					const { response, section } = pageResult(
						url,
						await loadPage(url, request, config, signal, fetchDeps, cache),
						request,
						perPageChars,
					);
					pages.push(response);
					sections.push(section);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					const { response, section } = errorResult(url, request, message);
					pages.push(response);
					sections.push(section);
				}
			}

			const formatted = formatBatch(sections, request.maxChars);
			const response: FetchBatch = { pages };
			const allFailed = pages.every((page) => page.error);

			return {
				content: [{ type: "text", text: formatted.text }],
				details: response,
				structuredContent: response,
				isError: allFailed ? true : undefined,
			};
		},

		renderCall(args, theme, context) {
			const { url, urls, find, startIndex } = args as WebFetchArgs;
			const target = urls?.length ? `${urls.length} urls` : oneLine(url ?? "");
			const text = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			let line = theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) + theme.fg("accent", target);
			if (find?.length) line += theme.fg("dim", ` find ${find.map((f) => `"${oneLine(f)}"`).join(", ")}`);
			else if (startIndex) line += theme.fg("dim", ` (from ${startIndex})`);
			text.setText(line);
			return text;
		},

		renderResult(result, _options, theme, context) {
			const text = context?.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = result.details as FetchBatch | undefined;
			if (!details || result.isError) {
				const first = result.content[0];
				const message = oneLine(first?.type === "text" ? first.text : "Fetch failed");
				text.setText(theme.fg("error", message.startsWith("Error:") ? message : `Error: ${message}`));
				return text;
			}

			const failed = details.pages.filter((page) => page.error).length;
			const cached = details.pages.filter((page) => page.cached).length;

			if (details.pages.length === 1) {
				const page = details.pages[0];
				if (page.error) {
					const message = oneLine(page.error);
					text.setText(theme.fg("error", message.startsWith("Error:") ? message : `Error: ${message}`));
					return text;
				}
				const label = oneLine(page.title || page.finalUrl);
				let line = theme.fg("muted", label);
				if (page.matches.length > 0) line += theme.fg("dim", ` · ${page.matches.length} match(es)`);
				else line += theme.fg("dim", ` · ${formatTokens(page.totalChars)} chars`);
				if (page.cached) line += theme.fg("dim", " (cached)");
				else if (page.rendered) line += theme.fg("dim", " (rendered)");
				text.setText(line);
				return text;
			}

			let line = theme.fg("muted", `${details.pages.length} pages`);
			line += theme.fg("dim", ` · ${details.pages.length - failed} ok`);
			if (failed > 0) line += theme.fg("error", `, ${failed} failed`);
			if (cached > 0) line += theme.fg("dim", `, ${cached} cached`);
			text.setText(line);
			return text;
		},
	});
}
