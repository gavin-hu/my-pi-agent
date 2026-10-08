/**
 * web-fetch — read web pages as text for Pi.
 *
 * Registers one `web_fetch` tool: a native-fetch GET, HTML turned into readable
 * Markdown-ish text, `startIndex`/`maxChars` paging, `find` for passage search,
 * and up to five URLs per call. Fetched pages are cached in-process for the
 * session. It is `direct` and active by default, and reads settings from
 * `~/.pi/agent/web-fetch.json` merged with `<cwd>/.pi/web-fetch.json`.
 *
 * Load with:  pi --extension ./extensions/web-fetch
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { cacheClear, cacheGet, cacheSet } from "./cache.ts";
import { loadConfig } from "./config.ts";
import { findPassages } from "./find.ts";
import { formatBatch, formatMatches, formatPage, type BatchSection } from "./format.ts";
import { runFetch, type PageResult } from "./page.ts";
import { MIN_CHARS, resolveRequest, WebFetchOutput, WebFetchParams, type WebFetchArgs } from "./schema.ts";
import type { FetchBatch, FetchResponse } from "./types.ts";

export const TOOL_NAME = "web_fetch";

export default function webFetch(pi: ExtensionAPI) {
	pi.on("session_shutdown", () => cacheClear());

	pi.registerTool({
		name: TOOL_NAME,
		label: "Web fetch",
		description:
			"Fetch one or more URLs and return their readable text (HTML is converted to plain text with links " +
			"preserved). Use it when you have a URL or need the actual content of a page. Long pages are paged: if the " +
			"result says it was truncated, call web_fetch again with the given startIndex. Pass `find` to get matching " +
			"passages and their offsets instead of the whole page. Provide `urls` to read up to five pages in one call; " +
			"a failure on one URL does not stop the others. Private/internal addresses are refused.",
		promptSnippet: "Fetch one or more URLs and read their page content as text; optionally find passages.",
		promptGuidelines: [
			"Use web_fetch when you have a URL or need a page's full content, not just a snippet.",
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
			const config = loadConfig(ctx.cwd);
			const request = resolveRequest(params as WebFetchArgs, config);
			const perPageChars = Math.max(MIN_CHARS, Math.floor(request.maxChars / request.urls.length));

			const pages: FetchResponse[] = [];
			const sections: BatchSection[] = [];

			for (const url of request.urls) {
				try {
					const cachedEntry =
						config.cacheEnabled && !request.refresh ? cacheGet(url, config.cacheTtlMs) : undefined;
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
						page = await runFetch(url, config, signal);
						fetchedAt = new Date().toISOString();
						if (config.cacheEnabled) {
							cacheSet(
								url,
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
							maxChars: perPageChars,
						});
						contentText = formatted.text;
						body = formatted.body;
						truncated = formatted.truncated;
					}

					pages.push({
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
						error: "",
					});
					sections.push({ url, text: contentText });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					pages.push({
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
						matches: [],
						fetchedAt: new Date().toISOString(),
						error: message,
					});
					sections.push({ url, text: `ERROR: ${message}` });
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

		renderCall(args, theme) {
			const { url, urls, find, startIndex } = args as WebFetchArgs;
			const target = urls?.length ? `${urls.length} urls` : (url ?? "");
			let text = theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) + theme.fg("accent", target);
			if (find?.length) text += theme.fg("dim", ` find ${find.map((f) => `"${f}"`).join(", ")}`);
			else if (startIndex) text += theme.fg("dim", ` (from ${startIndex})`);
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as FetchBatch | undefined;
			if (!details || result.isError) {
				const first = result.content[0];
				const message = first?.type === "text" ? first.text : "Fetch failed";
				return new Text(theme.fg("error", message.startsWith("Error:") ? message : `Error: ${message}`), 0, 0);
			}

			const failed = details.pages.filter((page) => page.error).length;
			const cached = details.pages.filter((page) => page.cached).length;

			if (details.pages.length === 1) {
				const page = details.pages[0];
				if (page.error) return new Text(theme.fg("error", page.error.startsWith("Error:") ? page.error : `Error: ${page.error}`), 0, 0);
				const label = page.title || page.finalUrl;
				let text = theme.fg("muted", label);
				if (page.matches.length > 0) text += theme.fg("dim", ` · ${page.matches.length} match(es)`);
				else text += theme.fg("dim", ` · ${page.totalChars} chars`);
				if (page.cached) text += theme.fg("dim", " (cached)");
				return new Text(text, 0, 0);
			}

			let text = theme.fg("muted", `${details.pages.length} pages`);
			text += theme.fg("dim", ` · ${details.pages.length - failed} ok`);
			if (failed > 0) text += theme.fg("error", `, ${failed} failed`);
			if (cached > 0) text += theme.fg("dim", `, ${cached} cached`);
			return new Text(text, 0, 0);
		},
	});
}
