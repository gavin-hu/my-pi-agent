/**
 * The tools that reach outside the session: web and files.
 *
 * Search, fetch, a structured document read, and a path opened in the OS;
 * each renders the shape its own details carry.
 */

import type { ToolFixture } from "./types.ts";

/** One entry per outside-world tool, in gallery order. */
export const WEB_FIXTURES: ToolFixture[] = [
	{
		name: "web_fetch",
		group: "package",
		label: "a fetched page",
		args: { url: "https://example.com/docs/retry" },
		result: {
			content: [{ type: "text", text: "Title: Retrying requests\nStatus: 200 (text/html)\n\nMost HTTP clients…" }],
			details: {
				url: "https://example.com/docs/retry",
				finalUrl: "https://example.com/docs/retry",
				title: "Retrying requests",
				status: 200,
				contentType: "text/html; charset=utf-8",
				text: "Most HTTP clients should retry idempotent requests when they fail with a 5xx or a connection error.",
				totalChars: 98,
				startIndex: 0,
				nextIndex: 0,
				truncated: false,
				cached: false,
				matches: [],
				matchesTruncated: false,
				fetchedAt: "2026-03-01T12:00:00.000Z",
				error: "",
			},
		},
	},
	{
		name: "web_search",
		group: "package",
		label: "search results",
		args: { query: "exponential backoff retry best practice", maxResults: 3 },
		result: {
			content: [{ type: "text", text: 'DuckDuckGo results for "exponential backoff retry best practice"' }],
			details: {
				query: "exponential backoff retry best practice",
				provider: "duckduckgo",
				answer: "Exponential backoff retries with jitter and a capped maximum delay.",
				results: [
					{
						title: "Exponential backoff — Wikipedia",
						url: "https://en.wikipedia.org/wiki/Exponential_backoff",
						snippet: "Exponential backoff multiplicatively decreases the rate of a process.",
					},
					{
						title: "Retry with backoff — AWS Architecture Blog",
						url: "https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/",
						snippet: "Add full jitter to avoid retry storms.",
					},
				],
				truncated: false,
				fetchedAt: "2026-03-01T12:01:00.000Z",
			},
		},
	},
	{
		name: "read_doc",
		group: "package",
		label: "an extracted, truncated document",
		args: { path: "docs/architecture.pdf" },
		result: {
			content: [{ type: "text", text: "Path: docs/architecture.pdf\nFormat: pdf\n\n1. Overview\nThe service…" }],
			details: {
				path: "docs/architecture.pdf",
				format: "pdf",
				bytes: 184_320,
				chars: 24_800,
				startIndex: 0,
				nextIndex: 8_000,
				truncated: true,
				text: "1. Overview\nThe service is split into an API tier and a worker tier…",
			},
		},
	},
	{
		name: "open_path",
		group: "package",
		label: "no custom renderer (generic fallback)",
		args: { path: "src/http.ts" },
		result: { content: [{ type: "text", text: "Opened /home/u/repo/project/src/http.ts" }] },
	},
];
