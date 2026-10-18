/**
 * The `web_search` tool.
 *
 * General web search through a pluggable provider. The keyless DuckDuckGo
 * provider is the default; SearXNG (self-hosted JSON) and Brave (keyed JSON) can
 * be selected through the `web-access.search` section of `bytefly.json`. Registered by
 * `web-access/index.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WEB_SEARCH_PROVIDER_CHANNEL } from "../../../lib/events.ts";
import { loadSearchConfig } from "../config.ts";
import { oneLine } from "../transcript.ts";
import { reuseText } from "../../../lib/tui/chrome.ts";
import {
	elapsedSuffix,
	rejectionLine,
	reuseCallText,
	startToolProgress,
	syncElapsedTimer,
	toolCallTitle,
} from "../../../lib/tui/tool.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { expandHint, SEPARATORS } from "../../../lib/tui/glyphs.ts";
import { providerFacts } from "./facts.ts";
import { formatResults } from "./format.ts";
import { createThrottle, runSearch, type SearchDeps } from "./search.ts";
import { resolveRequest, WebSearchOutput, WebSearchParams, type SearchResponse, type WebSearchArgs } from "./schema.ts";

export const TOOL_NAME = "web_search";

export function registerSearchTool(pi: ExtensionAPI, deps: SearchDeps = {}): void {
	// One throttle per extension instance, so repeated searches stay polite
	// without any module-level state.
	const runDeps: SearchDeps = { http: deps.http, throttle: deps.throttle ?? createThrottle() };

	// Publish what this session resolved to, so `doctor` can report the provider,
	// its key, and its endpoint without importing this extension. Accounting only:
	// a bus listener that throws must not break the tool.
	pi.on("session_start", (_event, ctx) => {
		try {
			pi.events.emit(WEB_SEARCH_PROVIDER_CHANNEL, providerFacts(loadSearchConfig(ctx.cwd)));
		} catch {
			// Diagnostics are best-effort.
		}
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: "Web search",
		description:
			"Search the web and return an answer and/or results (title, URL, snippet). Keyless by default (DuckDuckGo) " +
			"returns an answer and related topics rather than a general result list; `web-access.search.provider` in bytefly.json " +
			"can select a self-hosted SearXNG instance or a keyed Brave search.",
		promptSnippet: "Search the web for current information and pages.",
		promptGuidelines: [
			"Use web_search to discover pages and find current information.",
			"Follow up with web_fetch to read a promising result; a snippet is rarely enough on its own.",
		],
		parameters: WebSearchParams,
		outputSchema: WebSearchOutput,
		annotations: { readOnlyHint: true, openWorldHint: true },
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const config = loadSearchConfig(ctx.cwd);
			const request = resolveRequest(params as WebSearchArgs, config);
			startToolProgress(onUpdate);
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

		renderCall(args, theme, context) {
			const { query, maxResults } = args as WebSearchArgs;
			const text = reuseCallText(context?.lastComponent);
			let line = toolCallTitle(theme, `${TOOL_NAME} `) + paint(theme, "label", oneLine(query ?? ""));
			if (maxResults) line += paint(theme, "faint", ` (max ${maxResults})`);
			text.setText(line);
			return text;
		},

		renderResult(result, options, theme, context) {
			const startedAt = syncElapsedTimer(options.isPartial, context);
			const text = reuseText(context?.lastComponent);
			const details = result.details as SearchResponse | undefined;
			if (options.isPartial) {
				const elapsed = startedAt === undefined ? "" : elapsedSuffix(theme, Date.now() - startedAt);
				text.setText(paint(theme, "warn", "Searching…") + elapsed);
				return text;
			}
			if (!details || result.isError) {
				text.setText(rejectionLine(theme, result, options.expanded));
				return text;
			}
			if (details.provider === "none") {
				text.setText(paint(theme, "faint", `No results for "${oneLine(details.query)}".`));
				return text;
			}

			const count = details.results.length;
			// A blank line separates the call header from the result body.
			const lines: string[] = [
				"",
				paint(theme, "faint", `via ${details.provider}${SEPARATORS.item}${count} result${count === 1 ? "" : "s"}`) +
					elapsedSuffix(theme, context.durationMs),
			];
			if (details.answer)
				lines.push(`${paint(theme, "faint", "Answer:")} ${paint(theme, "meta", oneLine(details.answer, 160))}`);

			const shown = options.expanded ? details.results : details.results.slice(0, 5);
			const indent = paint(theme, "faint", "   ");
			for (const [index, item] of shown.entries()) {
				lines.push(`${paint(theme, "accent", `${index + 1}.`)} ${paint(theme, "meta", oneLine(item.title, 100))}`);
				lines.push(`${indent}${paint(theme, "faint", oneLine(item.url, 100))}`);
				if (options.expanded && item.snippet)
					lines.push(`${indent}${paint(theme, "meta", oneLine(item.snippet, 160))}`);
			}
			const extra = count - shown.length;
			if (extra > 0) lines.push(`${paint(theme, "faint", `+${extra} more`)} ${expandHint(theme)}`);
			text.setText(lines.join("\n"));
			return text;
		},
	});
}
