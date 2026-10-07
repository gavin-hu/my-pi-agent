/**
 * web-fetch — read a web page as text for Pi.
 *
 * Registers one `web_fetch` tool: a native-fetch GET, HTML turned into readable
 * Markdown-ish text, `startIndex`/`maxChars` paging, and `find` for passage
 * search. Fetched pages are cached in-process for the session. It is `direct`
 * and active by default, and reads settings from `~/.pi/agent/web-fetch.json`
 * merged with `<cwd>/.pi/web-fetch.json`.
 *
 * Load with:  pi --extension ./extensions/web-fetch
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { cacheClear, cacheGet, cacheSet } from "./cache.ts";
import { loadConfig } from "./config.ts";
import { findPassages } from "./find.ts";
import { formatMatches, formatPage } from "./format.ts";
import { runFetch, type PageResult } from "./page.ts";
import { resolveRequest, WebFetchOutput, WebFetchParams, type WebFetchArgs } from "./schema.ts";
import type { FetchResponse } from "./types.ts";

export const TOOL_NAME = "web_fetch";

export default function webFetch(pi: ExtensionAPI) {
	pi.on("session_shutdown", () => cacheClear());

	pi.registerTool({
		name: TOOL_NAME,
		label: "Web fetch",
		description:
			"Fetch a URL and return its readable text (HTML is converted to plain text with links preserved). Use it " +
			"when you have a URL or need the actual content of a page. Long pages are paged: if the result says it was " +
			"truncated, call web_fetch again with the given startIndex. Pass `find` to get matching passages and their " +
			"offsets instead of the whole page. Private/internal addresses are refused.",
		promptSnippet: "Fetch a URL and read its page content as text; optionally find passages.",
		promptGuidelines: [
			"Use web_fetch when you have a URL or need a page's full content, not just a snippet.",
			"Pass `find` to locate specific passages cheaply; then use startIndex to read around a hit.",
			"When the result is truncated, call web_fetch again with the suggested startIndex.",
		],
		parameters: WebFetchParams,
		outputSchema: WebFetchOutput,
		exposure: "direct",
		defaultActive: true,
		annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const config = loadConfig(ctx.cwd);
			const request = resolveRequest(params as WebFetchArgs, config);

			const cachedEntry = config.cacheEnabled && !request.refresh ? cacheGet(request.url, config.cacheTtlMs) : undefined;
			let page: PageResult;
			let cached = false;
			let fetchedAt: string;
			if (cachedEntry) {
				page = {
					url: cachedEntry.url,
					finalUrl: cachedEntry.finalUrl,
					title: cachedEntry.title,
					status: cachedEntry.status,
					contentType: cachedEntry.contentType,
					text: cachedEntry.text,
				};
				cached = true;
				fetchedAt = cachedEntry.fetchedAt;
			} else {
				page = await runFetch(request.url, config, signal);
				fetchedAt = new Date().toISOString();
				if (config.cacheEnabled) {
					cacheSet(
						request.url,
						{
							url: page.url,
							finalUrl: page.finalUrl,
							title: page.title,
							status: page.status,
							contentType: page.contentType,
							text: page.text,
							fetchedAt,
							storedAt: Date.now(),
							bytes: new TextEncoder().encode(page.text).length,
						},
						{ maxEntries: config.cacheMaxEntries, maxBytes: config.cacheMaxBytes },
					);
				}
			}

			const matches =
				request.find.length > 0
					? findPassages(page.text, request.find, {
							mode: request.mode,
							contextChars: request.contextChars,
							maxMatches: request.maxMatches,
						})
					: [];

			let contentText: string;
			let body: string;
			let truncated: boolean;
			if (request.find.length > 0) {
				const formatted = formatMatches({
					finalUrl: page.finalUrl,
					title: page.title,
					status: page.status,
					contentType: page.contentType,
					matches,
					find: request.find,
				});
				contentText = formatted.text;
				body = formatted.body;
				truncated = formatted.truncated;
			} else {
				const formatted = formatPage({
					finalUrl: page.finalUrl,
					title: page.title,
					status: page.status,
					contentType: page.contentType,
					text: page.text,
					startIndex: request.startIndex,
					maxChars: request.maxChars,
				});
				contentText = formatted.text;
				body = formatted.body;
				truncated = formatted.truncated;
			}

			const response: FetchResponse = {
				url: page.url,
				finalUrl: page.finalUrl,
				title: page.title,
				status: page.status,
				contentType: page.contentType,
				text: body,
				totalChars: Array.from(page.text).length,
				startIndex: request.startIndex,
				truncated,
				cached,
				matches,
				fetchedAt,
			};

			return {
				content: [{ type: "text", text: contentText }],
				details: response,
				structuredContent: response,
			};
		},

		renderCall(args, theme) {
			const { url, find, startIndex } = args as WebFetchArgs;
			let text = theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) + theme.fg("accent", url ?? "");
			if (find?.length) text += theme.fg("dim", ` find ${find.map((f) => `"${f}"`).join(", ")}`);
			else if (startIndex) text += theme.fg("dim", ` (from ${startIndex})`);
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as FetchResponse | undefined;
			if (!details || result.isError) {
				const first = result.content[0];
				const message = first?.type === "text" ? first.text : "Fetch failed";
				return new Text(theme.fg("error", message), 0, 0);
			}
			const label = details.title || details.finalUrl;
			let text = theme.fg("muted", label);
			if (details.matches.length > 0) text += theme.fg("dim", ` — ${details.matches.length} match(es)`);
			else text += theme.fg("dim", ` — ${details.totalChars} chars`);
			if (details.cached) text += theme.fg("dim", " (cached)");
			return new Text(text, 0, 0);
		},
	});
}
