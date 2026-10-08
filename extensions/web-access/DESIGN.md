# web-access — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Give the model keyless, dependency-free, fetch-only web access through two
tools: `web_search` (facts/topics via instant answers and Wikipedia) and
`web_fetch` (read a URL as text). One extension, one config file, one shared
native-`fetch` transport.

## Non-goals

- `web_search` is not a general web search engine: no arbitrary web results,
  news, or images.
- `web_fetch` does no model call, no JavaScript rendering, and no PDF/image
  extraction; it returns text and lets the model reason.
- No keys, no curation UI.

## Layout

The extension is two self-contained halves plus a thin entry point:

```
index.ts        registers both tools; clears the fetch cache on session_shutdown
config.ts       reads web-access.json and exposes the search/fetch sections
search/         the web_search half
fetch/          the web_fetch half
```

Each half owns its `config.ts`, `schema.ts`, `types.ts`, `format.ts`, and tool
definition (`tool.ts`), so the halves do not import each other.

## Shared code

[`http.ts`](./http.ts) holds the fetch runner (`HttpRunner`,
`createFetchRunner`, and the HTTP error types), used by both halves and
injectable for tests.

## `web_search`

| Field | Value |
|---|---|
| `name` | `web_search` |
| `label` | `Web search` |
| `exposure` | `direct` |
| `defaultActive` | `true` |
| `executionMode` | `sequential` |
| `annotations` | `readOnlyHint: true`, `openWorldHint: true`, `destructiveHint: false` |
| `outputSchema` | `WebSearchOutput` |

`resolveRequest()` validates the query and clamps `maxResults` to the configured
ceiling before any request.

### Providers

- **DuckDuckGo Instant Answer** —
  `https://api.duckduckgo.com/?q=&format=json&no_html=1&no_redirect=1&skip_disambig=1`
  is keyless and returns loosely-typed JSON. [`instant-answer.ts`](./search/instant-answer.ts)
  picks the best answer (`Answer`, then `AbstractText`, then `Definition`) and
  flattens `Results` plus nested `RelatedTopics` into deduplicated results.
- **Wikipedia** — [`wikipedia.ts`](./search/wikipedia.ts) uses the MediaWiki API
  with `generator=search&prop=extracts|info&...&explaintext=1`, so snippets are
  plain text and every page has a canonical URL. `wikipediaLang` defaults to
  `"auto"`: Han text uses `zh`, everything else `en`.

### Pipeline

[`search.ts`](./search/search.ts): ask the Instant Answer API (unless the source
is `wikipedia`, or `auto` with a Wikipedia operator); otherwise query Wikipedia;
if both are empty return `provider: "none"`. A process-wide `minIntervalMs`
throttle spaces requests out.

## `web_fetch`

| Field | Value |
|---|---|
| `name` | `web_fetch` |
| `label` | `Web fetch` |
| `exposure` | `direct` |
| `defaultActive` | `true` |
| `annotations` | `readOnlyHint: true`, `openWorldHint: true`, `destructiveHint: false` |
| `outputSchema` | `WebFetchOutput` |

Behaviour:

1. **Validate**: [`ssrf.ts`](./fetch/ssrf.ts) requires http(s), rejects obvious
   internal hostnames, and refuses any host that resolves to a loopback,
   RFC1918, link-local, unique-local, multicast, or metadata address
   (`allowPrivateHosts` opts out).
2. **Fetch**: [`page.ts`](./fetch/page.ts) uses the shared runner with a combined
   caller signal + timeout, `redirect: "follow"`, and a `maxBytes` cap.
3. **Route by content type**: HTML → [`extract.ts`](./fetch/extract.ts) readable
   text; other textual types → body as-is; binary → a short note.
4. **Format**: [`format.ts`](./fetch/format.ts) slices by code point from
   `startIndex` and reports the next index; with `find`,
   [`find.ts`](./fetch/find.ts) returns passages and their offsets instead.
5. **Batch**: with `urls`, steps 1–4 run per URL; a failure is recorded on that
   page and does not abort the others. `maxChars` is split evenly. The result is
   marked `isError` only when every page failed.

### Find-in-page

`find` runs over the extracted text: `exact` is case-sensitive, `insensitive`
lowercases both sides, and `fuzzy` scores lines by the fraction of query terms
they contain (a spaceless CJK term expands to its characters), keeping lines
≥ 50%. Passages carry `contextChars` of context, and offsets line up with
`startIndex` so a hit can be read with a second call.

### Page cache

[`cache.ts`](./fetch/cache.ts) is an in-process LRU/TTL keyed by requested URL,
holding extracted pages so paging and find-in-page are a single fetch. Entries
are evicted by count and total bytes; `refresh: true` bypasses it, and
`session_shutdown` (in `index.ts`) clears it.

## Configuration

[`config.ts`](./config.ts) reads `~/.pi/agent/web-access.json` then
`<cwd>/.pi/web-access.json` (project wins), taking the optional `search` and
`fetch` objects and validating each with its half's normalizer. Missing or
malformed files and unknown keys are ignored; values are clamped. See the README
for the full key list.

## Files

| File | Purpose |
|---|---|
| `index.ts` | Register both tools; clear the fetch cache on shutdown |
| `config.ts` | Nested `web-access.json` loader |
| `search/tool.ts` | `web_search` definition, activation, rendering |
| `search/config.ts` | Search config type, defaults, clamping |
| `search/schema.ts` | Params/output schema, `resolveRequest()` |
| `search/search.ts` | Instant-answer → Wikipedia pipeline and throttle |
| `search/instant-answer.ts`, `search/wikipedia.ts`, `search/json.ts` | Provider clients/parsers |
| `search/format.ts`, `search/types.ts` | Result text and data types |
| `fetch/tool.ts` | `web_fetch` definition, activation, rendering |
| `fetch/config.ts` | Fetch config type, defaults, clamping |
| `fetch/schema.ts` | Params/output schema, `resolveRequest()` |
| `fetch/page.ts` | Fetch + content-type routing, test runner seam |
| `fetch/ssrf.ts` | URL/host validation and private-address blocking |
| `fetch/extract.ts` | HTML → title + readable text |
| `fetch/find.ts` | Passage search (exact/insensitive/fuzzy) |
| `fetch/cache.ts` | In-process LRU/TTL page cache |
| `fetch/format.ts`, `fetch/types.ts` | Result text and data types |

## Testing

`test/web-access/` mirrors the halves (`search/`, `fetch/`) plus top-level
`config.test.ts` and `index.test.ts`. It covers the shared runner (via injected
`fetch`), the search pipeline and providers, extraction, formatting/paging,
find, the cache, the SSRF guard, the nested config merge and section isolation,
and both tools' registration/execution. The runtime smoke test only asserts
registration.

## Risks

- Fetched page text and instant answers are untrusted and may contain
  prompt-injection content; the tools return it as-is.
- Search results are sparse by design (no general web index).
- Heuristic extraction can miss content or include chrome; the SSRF guard is
  best-effort (DNS changes and internal redirects are not fully covered).
- The page cache is in-memory and per session, so a page can be stale until
  `refresh: true` or shutdown.
