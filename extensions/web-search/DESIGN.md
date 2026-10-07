# `web_search` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Give the model a keyless, dependency-free, fetch-only way to look things up:
DuckDuckGo Instant Answers first, Wikipedia as a fallback. It replaces the
DuckDuckGo HTML-scraping version, which needed the `curl` binary because
DuckDuckGo's anti-bot layer challenges Node/Bun `fetch`.

## Non-goals

- Not a general web search engine: instant answers cover facts/definitions, and
  Wikipedia covers topics. For arbitrary pages, `web_fetch` reads a URL.
- No news/images/video, no keyed providers, no curation UI, no caching.

## Shared code

The fetch runner (`HttpRunner`, `createFetchRunner`, and the HTTP error types)
lives in `extensions/_shared/http.ts`, shared with `web_fetch`.

## Model surface

| Field | Value |
|---|---|
| `name` | `web_search` |
| `label` | `Web search` |
| `exposure` | `direct` (callable from codemode while active) |
| `defaultActive` | `true` |
| `executionMode` | `sequential` |
| `annotations` | `readOnlyHint: true`, `openWorldHint: true`, `destructiveHint: false` |
| `outputSchema` | `WebSearchOutput` |

### Parameters (TypeBox)

```ts
web_search({
  query: string,        // 1–400 chars, required, any language
  maxResults?: number,  // 1–20, capped by config.maxResults
  source?: "auto" | "instant" | "wikipedia",  // default auto
})
```

Wikipedia operators (`intitle:`, `incategory:`, `insource:`, …) are forwarded to
`gsrsearch`. `source: "wikipedia"` skips the instant answer; `source: "instant"`
skips Wikipedia; `auto` skips the instant answer when the query contains a
Wikipedia operator.

`resolveRequest()` validates the query and clamps `maxResults` to the configured
ceiling before any request.

### Result

`content` is an optional `Answer:` line plus numbered results (title, URL,
snippet), kept within `maxOutputChars`. `details` and `structuredContent` are
identical:

```ts
{ query, provider: "duckduckgo" | "wikipedia" | "none", answer, results, truncated, fetchedAt }
```

## Providers

### DuckDuckGo Instant Answer

`https://api.duckduckgo.com/?q=&format=json&no_html=1&no_redirect=1&skip_disambig=1`
is keyless and returns loosely-typed JSON. [`instant-answer.ts`](./instant-answer.ts)
picks the best answer (`Answer`, then `AbstractText`, then `Definition`), records
its source/URL, and flattens `Results` plus nested `RelatedTopics` groups into
de-duplicated results (title from the text before `" - "`).

### Wikipedia

[`wikipedia.ts`](./wikipedia.ts) uses the MediaWiki API with
`generator=search&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exchars=500`,
so snippets are plain text (no HTML to parse) and every page includes its
canonical URL. Results are ordered by the generator's `index`.

`wikipediaLang` defaults to `"auto"`: Han text uses `zh`, everything else `en`.

## Pipeline

[`search.ts`](./search.ts):

1. Ask the Instant Answer API (unless the source is `wikipedia`, or `auto` with a
   Wikipedia operator). If it has an answer or topics, return them
   (`provider: "duckduckgo"`).
2. Otherwise query Wikipedia (unless the source is `instant`). If it returns
   pages, return them (`provider: "wikipedia"`).
3. If both are empty, return `provider: "none"`. If a request failed, the
   failure is surfaced (unless a later backend answered).

A process-wide `minIntervalMs` throttle spaces requests out.

## Configuration

Merged from `~/.pi/agent/web-search.json` (global) and
`<cwd>/.pi/web-search.json` (project, wins). Missing or malformed files are
ignored; values are validated/clamped.

```jsonc
{
  "maxResults": 8,                                        // 1–20
  "timeoutMs": 15000,                                     // 1000–120000
  "maxBytes": 5000000,                                    // 1024–50000000
  "minIntervalMs": 500,                                   // 0–60000
  "maxOutputChars": 12000,                                // 1000–100000
  "userAgent": "my-pi-agent/0.1 (+https://github.com/gavin-hu/my-pi-agent)",
  "wikipediaLang": "auto",                                // "auto" | language code
  "instantAnswerEndpoint": "https://api.duckduckgo.com/",
  "wikipediaEndpoint": "https://{lang}.wikipedia.org/w/api.php"
}
```

## Files

| File | Purpose |
|---|---|
| `index.ts` | Tool definition, activation, rendering |
| `config.ts` | Config type, defaults, merge, clamping |
| `types.ts` | `SearchResult` / `SearchRequest` / `SearchResponse` |
| `schema.ts` | TypeBox params, output schema, `resolveRequest()` |
| `http.ts` | Native-fetch runner (`HttpRunner`, errors, timeout, size cap) |
| `instant-answer.ts` | DuckDuckGo Instant Answer client and parser |
| `wikipedia.ts` | Wikipedia client, language selection, parser |
| `search.ts` | Pipeline, throttle, `WebSearchError`, test runner seam |
| `format.ts` | Answer + results text and truncation |

## Testing

`test/web-search/` covers the fetch runner (with an injected `fetch`), the
Instant Answer parser (answers, nested topics, dedup, empty), Wikipedia
(language pick, index ordering, dedup, limit), the pipeline (instant answer →
Wikipedia → none, error handling), formatting/truncation, config, and tool
registration/execution. The runtime smoke test only asserts registration.

## Risks

- Instant Answers are empty for many queries by design; Wikipedia covers
  factual/topic queries, not arbitrary web pages. The tool description and
  guidelines steer the model to `web_fetch` for pages.
- Both APIs are third-party services; responses are untrusted text.
