/**
 * web-fetch — read a web page as text for Pi.
 *
 * Registers one `web_fetch` tool: a native-fetch GET, HTML turned into readable
 * Markdown-ish text, with `startIndex`/`maxChars` paging. It is `direct` and
 * active by default, and reads settings from `~/.pi/agent/web-fetch.json` merged
 * with `<cwd>/.pi/web-fetch.json`.
 *
 * Load with:  pi --extension ./extensions/web-fetch
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { loadConfig } from "./config.ts";
import { formatPage } from "./format.ts";
import { runFetch } from "./page.ts";
import { resolveRequest, WebFetchOutput, WebFetchParams, type WebFetchArgs } from "./schema.ts";
import type { FetchResponse } from "./types.ts";

export const TOOL_NAME = "web_fetch";

export default function webFetch(pi: ExtensionAPI) {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Web fetch",
		description:
			"Fetch a URL and return its readable text (HTML is converted to plain text with links preserved). Use it " +
			"when you have a URL or need the actual content of a page. Long pages are paged: if the result says it was " +
			"truncated, call web_fetch again with the given startIndex. Private/internal addresses are refused.",
		promptSnippet: "Fetch a URL and read its page content as text.",
		promptGuidelines: [
			"Use web_fetch when you have a URL or need a page's full content, not just a snippet.",
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
			const page = await runFetch(request.url, config, signal);

			const formatted = formatPage({
				finalUrl: page.finalUrl,
				title: page.title,
				status: page.status,
				contentType: page.contentType,
				text: page.text,
				startIndex: request.startIndex,
				maxChars: request.maxChars,
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
				fetchedAt: new Date().toISOString(),
			};

			return {
				content: [{ type: "text", text: formatted.text }],
				details: response,
				structuredContent: response,
			};
		},

		renderCall(args, theme) {
			const { url, startIndex } = args as WebFetchArgs;
			let text = theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) + theme.fg("accent", url ?? "");
			if (startIndex) text += theme.fg("dim", ` (from ${startIndex})`);
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
			text += theme.fg("dim", ` — ${details.totalChars} chars`);
			if (details.truncated) text += theme.fg("dim", ` (showing from ${details.startIndex})`);
			return new Text(text, 0, 0);
		},
	});
}
