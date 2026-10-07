# `web_search` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Give the model a small, dependable way to search the web from Pi without a
heavyweight package: one `web_search` tool, keyless DuckDuckGo, JSON config, no
new dependencies. It replaces the much larger
[`pi-web-access`](https://github.com/nicobailon/pi-web-access) for the common
"look this up" case while staying auditable in a single afternoon.

## Non-goals

- Not a page-content fetcher: results are snippets only. Reading a page stays
  the job of `fetch`/`bash`/`read` or a future `fetch_content` tool.
- Not a keyed, multi-provider search aggregator, and not a curator UI.
- Not news/image/video search, and not JS-rendered search engines.
- No cross-session persistence or caching beyond the process-wide politeness
  timestamp.

## Model surface

| Field | Value |
|---|---|
| `name` | `web_search` |
| `label` | `Web search` |
| `exposure` | `direct` (declared to the model while active, callable from codemode scripts) |
| `defaultActive` | `true` |
| `executionMode` | `sequential` |
| `annotations` | `readOnlyHint: true`, `openWorldHint: true`, `destructiveHint: false` |
| `outputSchema` | `WebSearchOutput` |

### Parameters (TypeBox)

```ts
web_search({
  query: string,                 // 1–400 chars, required, any language
  maxResults?: number,           // 1–20, capped by config.maxResults
  region?: string,               // "wt-wt" | xx-xx, e.g. "cn-zh", "us-en"
  safeSearch?: "strict" | "moderate" | "off",
})
```

`resolveRequest()` in [`schema.ts`](./schema.ts) merges the arguments with the
config and validates them before any network call. It throws a model-readable
`Error` on an empty/oversized query or a malformed region. Per-call
`maxResults` can only lower the configured ceiling.

### Result

`content` (model-facing text) is a numbered list of title, URL, and snippet,
kept within `maxOutputChars`. `details` and `structuredContent` are identical
`SearchResponse` objects so codemode scripts get structured data:

```ts
{ query, provider: "duckduckgo", results: { title, url, snippet }[], truncated, fetchedAt }
```

## Provider: DuckDuckGo classic HTML (via curl)

- **POST** to `https://html.duckduckgo.com/html/` with form fields
  `q`, `b=""`, `kl=<region>`, `kp=<safe search>`. A plain GET is served the
  "select all ducks" anti-bot challenge; POST with browser-like headers
  (`User-Agent`, `Accept`, `Accept-Language`, `Referer`) returns organic
  results. Verified for English and Chinese queries.
- **Transport is `curl`, not `fetch`.** DuckDuckGo's anomaly detection
  challenges Node/Bun `fetch` clients with HTTP 202 even when every header
  matches, but serves the identical POST from curl. `pi-web-access` hit the same
  wall: its DuckDuckGo provider used `fetch` and was demoted to explicit-only,
  with Exa MCP as its actual keyless default. Requests are built as an argv
  array and run with `execFile`, so there is no shell and the query cannot be
  interpreted as a command. `curlPath` selects the binary.
- **Language**: DuckDuckGo is Bing-index-backed and detects query language, so
  zh and en both work. `region` defaults to `wt-wt` (no region) so bilingual
  queries are not biased; `acceptLanguage` defaults to
  `zh-CN,zh;q=0.9,en;q=0.8`. It is weaker than Baidu for mainland-China
  long-tail local content.
- **Politeness**: one process-wide timestamp enforces `minIntervalMs`, and the
  tool runs sequentially, so parallel model calls cannot burst the endpoint.
- **Failure modes**: missing curl, non-2xx, timeout, caller abort, and the
  anti-bot challenge all raise `WebSearchError` with a clear message. An empty
  result list means the query genuinely had no hits.

[`duckduckgo.ts`](./duckduckgo.ts) takes an injectable `HttpPoster`, and
[`curl.ts`](./curl.ts) takes an injectable `execFile`, so tests never touch the
network or spawn a process.

## Parser

[`parse.ts`](./parse.ts) is pure and dependency-free:

- split the page into `<div class="result …">` blocks and skip `result--ad`;
- take the first `result__a` anchor's `href` and text, plus `result__snippet`;
- unwrap `//duckduckgo.com/l/?uddg=<url>` redirects;
- decode named/numeric HTML entities, strip tags, collapse whitespace;
- de-duplicate URLs and drop non-http(s) entries;
- pass CJK text through unchanged.

## Configuration

Merged from `~/.pi/agent/web-search.json` (global) and
`<cwd>/.pi/web-search.json` (project, wins). Missing or malformed files are
ignored, and every value is validated/clamped by `normalizeConfig()`.

```jsonc
{
  "maxResults": 8,                               // 1–20
  "region": "wt-wt",                             // any | xx-xx
  "acceptLanguage": "zh-CN,zh;q=0.9,en;q=0.8",
  "safeSearch": "moderate",                       // strict | moderate | off
  "timeoutMs": 20000,                             // 1000–120000
  "minIntervalMs": 1000,                          // 0–60000
  "endpoint": "https://html.duckduckgo.com/html/",
  "curlPath": "curl",                             // binary name or absolute path
  "userAgent": null,                              // null → built-in browser UA
  "maxOutputChars": 12000                         // 1000–100000
}
```

## Files

| File | Purpose |
|---|---|
| `index.ts` | Tool definition, activation, rendering |
| `config.ts` | Config type, defaults, merge, clamping |
| `types.ts` | `SearchResult` / `SearchRequest` / `SearchResponse` |
| `schema.ts` | TypeBox params, output schema, `resolveRequest()` |
| `duckduckgo.ts` | Request building, throttle, errors, response handling |
| `curl.ts` | `curl` transport: argv builder, runner, output parser, errors |
| `parse.ts` | HTML → `SearchResult[]`, redirect/entity decoding |
| `format.ts` | Model-facing text and truncation |

## Testing

`test/web-search/` covers the parser (including a CJK fixture), config merging
and clamping, the request layer with an injected `HttpPoster` (form fields, `kp`
mapping, region pass-through, challenge detection, HTTP error, abort, timeout,
throttle), the curl transport with an injected `execFile` (argv, output parsing,
ENOENT, stderr, abort, timeout), formatting/truncation, and tool
registration/execution. The runtime smoke test only asserts registration and
exposure; it never performs a live search.

## Risks

- Keyless scraping is inherently brittle: DuckDuckGo may change its markup or
  serve the challenge on some networks. The challenge page is detected and
  reported rather than silently returning nothing.
- The request depends on the `curl` binary being on `PATH` (or `curlPath`
  pointing at it). Its absence produces a clear error.
- Markup drift is contained to `parse.ts` and its fixtures.
