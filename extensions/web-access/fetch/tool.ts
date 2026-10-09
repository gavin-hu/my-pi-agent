/**
 * The `web_fetch` tool.
 *
 * A native-fetch GET/POST with HTML turned into readable Markdown-ish text,
 * optional PDF text extraction and JS rendering, `startIndex`/`maxChars` paging,
 * `find` for passage search, and up to five URLs per call. Redirects are
 * followed with every hop SSRF-checked, and pages are cached in-process for the
 * session (cleared by `web-access/index.ts` on shutdown); the `fetch` section of
 * `web-access.json` configures it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatTokens } from "../../../lib/format.ts";
import { oneLine } from "../transcript.ts";
import { cacheGet, cacheSet } from "./cache.ts";
import type { WebFetchConfig } from "./config.ts";
import { findPassages } from "./find.ts";
import { formatBatch, formatMatches, formatPage, type BatchSection } from "./format.ts";
import { runFetch, type PageResult } from "./page.ts";
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

interface LoadedPage {
	page: PageResult;
	cached: boolean;
	fetchedAt: string;
}

/** Fetch one URL, serving from and populating the session cache when allowed. */
async function loadPage(
	url: string,
	request: FetchRequest,
	config: WebFetchConfig,
	signal: AbortSignal | undefined,
): Promise<LoadedPage> {
	const cacheable = config.cacheEnabled && request.cacheable && !request.refresh;
	const cachedEntry = cacheable ? cacheGet(url, config.cacheTtlMs) : undefined;
	if (cachedEntry) return { page: cachedEntry, cached: true, fetchedAt: cachedEntry.fetchedAt };

	const page = await runFetch(url, request, config, signal);
	const fetchedAt = new Date().toISOString();
	if (config.cacheEnabled && request.cacheable) {
		cacheSet(
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
	const matches =
		request.find.length > 0
			? findPassages(page.text, request.find, {
					mode: request.mode,
					contextChars: request.contextChars,
					maxMatches: request.maxMatches,
				})
			: [];

	const formatted =
		request.find.length > 0
			? formatMatches({
					finalUrl: page.finalUrl,
					title: page.title,
					status: page.status,
					contentType: page.contentType,
					matches,
					find: request.find,
				})
			: formatPage({
					finalUrl: page.finalUrl,
					title: page.title,
					status: page.status,
					contentType: page.contentType,
					text: page.text,
					startIndex: request.startIndex,
					maxChars: perPageChars,
				});

	const response: FetchResponse = {
		url: page.url,
		finalUrl: page.finalUrl,
		title: page.title,
		status: page.status,
		contentType: page.contentType,
		text: formatted.body,
		totalChars: Array.from(page.text).length,
		startIndex: request.startIndex,
		truncated: formatted.truncated,
		cached,
		rendered: page.rendered,
		matches,
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
			truncated: false,
			cached: false,
			rendered: false,
			matches: [],
			fetchedAt: new Date().toISOString(),
			error: message,
		},
		section: { url, text: `ERROR: ${message}` },
	};
}

export function registerFetchTool(pi: ExtensionAPI): void {
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
			const perPageChars = Math.max(MIN_CHARS, Math.floor(request.maxChars / request.urls.length));

			const pages: FetchResponse[] = [];
			const sections: BatchSection[] = [];

			for (const url of request.urls) {
				try {
					const { response, section } = pageResult(
						url,
						await loadPage(url, request, config, signal),
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
