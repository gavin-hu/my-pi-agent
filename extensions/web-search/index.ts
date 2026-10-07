/**
 * web-search — keyless web search for Pi.
 *
 * Registers one `web_search` tool backed by DuckDuckGo's classic HTML endpoint.
 * It is `direct` and active by default (also callable from codemode scripts
 * while active), runs sequentially, and reads its settings from
 * `~/.pi/agent/web-search.json` merged with `<cwd>/.pi/web-search.json`.
 *
 * Load with:  pi --extension ./extensions/web-search
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { loadConfig } from "./config.ts";
import { searchDuckDuckGo } from "./duckduckgo.ts";
import { formatResults } from "./format.ts";
import { resolveRequest, WebSearchOutput, WebSearchParams, type WebSearchArgs } from "./schema.ts";
import type { SearchResponse } from "./types.ts";

export const TOOL_NAME = "web_search";

export default function webSearch(pi: ExtensionAPI) {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Web search",
		description:
			"Search the web and get ranked results (title, URL, snippet). Keyless DuckDuckGo; works for Chinese and " +
			"English. Use it for current facts, documentation, or anything not in the repository. Prefer specific " +
			"queries; results are snippets only, so open a promising URL with fetch/bash when you need the full page.",
		promptSnippet: "Search the web for ranked results with titles, URLs, and snippets.",
		promptGuidelines: [
			"Use web_search for current or external information, then read promising pages rather than trusting snippets.",
			"Issue specific queries; multiple narrow web_search calls usually beat one broad query.",
		],
		parameters: WebSearchParams,
		outputSchema: WebSearchOutput,
		exposure: "direct",
		defaultActive: true,
		annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const config = loadConfig(ctx.cwd);
			const request = resolveRequest(params as WebSearchArgs, config);
			const results = await searchDuckDuckGo(request, config, signal);

			const response: SearchResponse = {
				query: request.query,
				provider: "duckduckgo",
				results,
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
			const { query, maxResults, region } = args as WebSearchArgs;
			let text = theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) + theme.fg("accent", query ?? "");
			const meta = [region, maxResults ? `${maxResults} results` : undefined].filter(Boolean);
			if (meta.length > 0) text += theme.fg("dim", ` (${meta.join(", ")})`);
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as SearchResponse | undefined;
			if (!details || result.isError) {
				const first = result.content[0];
				const message = first?.type === "text" ? first.text : "Search failed";
				return new Text(theme.fg("error", message), 0, 0);
			}
			if (details.results.length === 0) {
				return new Text(theme.fg("dim", `No results for "${details.query}".`), 0, 0);
			}

			const shown = details.results.slice(0, 5);
			const lines = shown.map(
				(item, index) => `${theme.fg("accent", `${index + 1}.`)} ${theme.fg("muted", item.title)}`,
			);
			const extra = details.results.length - shown.length;
			if (extra > 0) lines.push(theme.fg("dim", `+${extra} more`));
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
