/**
 * web-search — keyless, fetch-only web lookup for Pi.
 *
 * Registers one `web_search` tool: DuckDuckGo Instant Answers first, Wikipedia
 * as a fallback. Both are keyless and use native `fetch`. It is `direct` and
 * active by default, and reads settings from `~/.pi/agent/web-search.json`
 * merged with `<cwd>/.pi/web-search.json`.
 *
 * Load with:  pi --extension ./extensions/web-search
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { loadConfig } from "./config.ts";
import { formatResults } from "./format.ts";
import { runSearch } from "./search.ts";
import { resolveRequest, WebSearchOutput, WebSearchParams, type WebSearchArgs } from "./schema.ts";
import type { SearchResponse } from "./types.ts";

export const TOOL_NAME = "web_search";

export default function webSearch(pi: ExtensionAPI) {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Web search",
		description:
			"Look up a quick fact, definition, or topic. Uses DuckDuckGo instant answers first and falls back to " +
			"Wikipedia, so it returns answers and encyclopedia-style results (title, URL, snippet) rather than general " +
			"web results. For anything else, or when you already have a URL, use web_fetch to read the page.",
		promptSnippet: "Look up a fact/topic via DuckDuckGo instant answers, falling back to Wikipedia.",
		promptGuidelines: [
			"Use web_search for quick facts and encyclopedia topics; it is not a general web search engine.",
			"When you need current or niche information, or a specific page, use web_fetch instead.",
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
			const outcome = await runSearch(request, config, signal);

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
				return new Text(theme.fg("error", message), 0, 0);
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
