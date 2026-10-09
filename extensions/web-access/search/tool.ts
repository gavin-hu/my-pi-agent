/**
 * The `web_search` tool.
 *
 * General web search through a pluggable provider. The keyless DuckDuckGo
 * provider is the default; SearXNG (self-hosted JSON) and Brave (keyed JSON) can
 * be selected through the `search` section of `web-access.json`. Registered by
 * `web-access/index.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { loadSearchConfig } from "../config.ts";
import { formatResults } from "./format.ts";
import { createThrottle, runSearch, type SearchDeps } from "./search.ts";
import { resolveRequest, WebSearchOutput, WebSearchParams, type SearchResponse, type WebSearchArgs } from "./schema.ts";

export const TOOL_NAME = "web_search";

export function registerSearchTool(pi: ExtensionAPI, deps: SearchDeps = {}): void {
	// One throttle per extension instance, so repeated searches stay polite
	// without any module-level state.
	const runDeps: SearchDeps = { http: deps.http, throttle: deps.throttle ?? createThrottle() };

	pi.registerTool({
		name: TOOL_NAME,
		label: "Web search",
		description:
			"Search the web. Returns a direct answer and/or general web results (title, URL, snippet). " +
			"Works out of the box with no configuration (DuckDuckGo); search.provider in web-access.json can select a " +
			"self-hosted SearXNG instance or a keyed Brave search. Use web_fetch to read a promising result.",
		promptSnippet: "Search the web (keyless by default; optional SearXNG or Brave).",
		promptGuidelines: [
			"Use web_search to discover pages and find current information.",
			"web_search works with no configuration; set search.endpoint for a self-hosted SearXNG or search.apiKeyEnv for Brave.",
			"The keyless default returns answers and related topics, not a general result list; configure SearXNG or Brave for full results.",
			"Follow up with web_fetch to read a promising result.",
		],
		parameters: WebSearchParams,
		outputSchema: WebSearchOutput,
		exposure: "direct",
		defaultActive: true,
		annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const config = loadSearchConfig(ctx.cwd);
			const request = resolveRequest(params as WebSearchArgs, config);
			const outcome = await runSearch(request, config, signal, runDeps);

			const response: SearchResponse = {
				query: request.query,
				provider: outcome.provider,
				answer: outcome.answer,
				results: outcome.results,
				truncated: false,
				fetchedAt: new Date().toISOString(),
			};
			const formatted = formatResults(response, config.maxOutputChars);
			response.truncated = formatted.truncated;

			return {
				content: [{ type: "text", text: formatted.text }],
				details: response,
				structuredContent: response,
			};
		},

		renderCall(args, theme) {
			const { query, maxResults } = args as WebSearchArgs;
			let text = theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) + theme.fg("accent", query ?? "");
			if (maxResults) text += theme.fg("dim", ` (${maxResults} results)`);
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as SearchResponse | undefined;
			if (!details || result.isError) {
				const first = result.content[0];
				const message = first?.type === "text" ? first.text : "Search failed";
				return new Text(theme.fg("error", `Error: ${message}`), 0, 0);
			}
			if (details.provider === "none") {
				return new Text(theme.fg("dim", `No results for "${details.query}".`), 0, 0);
			}

			const lines: string[] = [theme.fg("dim", `via ${details.provider}`)];
			if (details.answer) lines.push(theme.fg("muted", details.answer.slice(0, 160)));
			const shown = details.results.slice(0, 5);
			lines.push(
				...shown.map((item, index) => `${theme.fg("accent", `${index + 1}.`)} ${theme.fg("muted", item.title)}`),
			);
			const extra = details.results.length - shown.length;
			if (extra > 0) lines.push(theme.fg("dim", `+${extra} more`));
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
