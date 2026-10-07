# `web_fetch` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Give the model a dependency-free, fetch-only way to read a URL: convert HTML to
readable text, page long output, and refuse internal targets. Complements
`web_search`, which only returns instant answers and encyclopedia snippets.

## Non-goals

- No model call and no "answer the prompt about this page" mode: it returns the
  page text and lets the model reason.
- No JavaScript rendering, PDFs, images, or binary extraction.

## Shared code

The fetch runner (`HttpRunner`, `createFetchRunner`, and the HTTP error types)
lives in `extensions/_shared/http.ts`, shared with `web_search`. Each extension
still owns its page/search logic and stays otherwise self-contained.

## Model surface

| Field | Value |
|---|---|
| `name` | `web_fetch` |
| `label` | `Web fetch` |
| `exposure` | `direct` (callable from codemode while active) |
| `defaultActive` | `true` |
| `annotations` | `readOnlyHint: true`, `openWorldHint: true`, `destructiveHint: false` |
| `outputSchema` | `WebFetchOutput` |

### Parameters (TypeBox)

```ts
web_fetch({
  url?: string,          // absolute http(s); provide url or urls
  urls?: string[],       // 1–5 URLs, fetched sequentially
  startIndex?: number,   // code-point offset, applied to every page (default 0)
  maxChars?: number,     // ≥200; split across pages, capped by config.maxOutputChars
  find?: string[],       // 1–10 terms; return passages instead of the page
  mode?: "insensitive" | "exact" | "fuzzy",  // default insensitive
  contextChars?: number, // 0–2000, default 200
  maxMatches?: number,   // 1–50, default 8
  refresh?: boolean,     // bypass the cache
})
```

### Result

`content` is a `### <url>` section per page, each with a header
(`Title`, `URL`, `Status`) and its text slice, or `ERROR: …` when it failed.
`details`/`structuredContent` is always `{ pages: [...] }`, one entry per URL:

```ts
{ pages: [{ url, finalUrl, title, status, contentType, text, totalChars, startIndex, truncated, cached, matches, fetchedAt, error }] }
```

`text` is the returned slice; `totalChars` is the whole extracted text length in
code points, and the note tells the model the next `startIndex` to use.

## Behavior

1. **Validate**: [`ssrf.ts`](./ssrf.ts) requires http(s), rejects obvious
   internal hostnames, and refuses any host that resolves to a loopback,
   RFC1918, link-local, unique-local, multicast, or metadata address
   (`allowPrivateHosts` opts out).
2. **Fetch**: [`http.ts`](./http.ts) is a native-`fetch` runner with a combined
   caller signal + timeout, `redirect: "follow"`, and a `maxBytes` cap.
3. **Route by content type**:
   - HTML → [`extract.ts`](./extract.ts) readable text;
   - other textual types (JSON/text/XML) → body as-is;
   - binary → a short `(binary content: …)` note.
4. **Format**: [`format.ts`](./format.ts) slices by code point from `startIndex`
   and reports the next index; with `find`, [`find.ts`](./find.ts) returns
   passages and their code-point offsets instead.
5. **Batch**: with `urls`, steps 1–4 run per URL; a failure is recorded on that
   page (`error`, `status: 0`) and does not abort the others. `maxChars` is split
   evenly across pages (`max(200, floor(maxChars / n))`), and the joined text is
   truncated at `maxChars`. The result is marked `isError` only when every page
   failed.

### Find-in-page

`find` runs over the extracted text (what the model sees, not raw HTML):
`exact` is a case-sensitive scan, `insensitive` lowercases both sides, and
`fuzzy` scores lines by the fraction of query terms they contain (a spaceless CJK
term expands to its characters), keeping lines ≥ 50% and ranking by score.
Passages carry `contextChars` of context with `…` when clipped, and offsets line
up with `startIndex` so a hit can be read precisely with a second call.

### Page cache

[`cache.ts`](./cache.ts) is an in-process LRU keyed by the requested URL,
holding extracted pages for `cacheTtlMs`. It makes paging and find-in-page a
single fetch. Entries are evicted by count and total bytes; `refresh: true`
bypasses it, and `session_shutdown` clears it.

### Extraction

[`extract.ts`](./extract.ts) is a heuristic readability pass, not a DOM parser:
it drops comments and `script/style/noscript/template/svg/iframe/form/nav/footer/
header/aside`, prefers the largest `<main>`/`<article>` (falling back to `<body>`
when that candidate is only a fragment), converts headings to `#`, list items to
`-`, links to `[text](absolute-url)`, images to their alt text, decodes entities,
and collapses whitespace. CJK passes through.

## Configuration

Merged from `~/.pi/agent/web-fetch.json` (global) and
`<cwd>/.pi/web-fetch.json` (project, wins). Missing or malformed files are
ignored; values are validated/clamped.

```jsonc
{
  "timeoutMs": 20000,                                     // 1000–120000
  "maxBytes": 5000000,                                    // 1024–50000000
  "maxOutputChars": 20000,                                // 500–100000
  "userAgent": "my-pi-agent/0.1 (+https://github.com/gavin-hu/my-pi-agent)",
  "acceptLanguage": "zh-CN,zh;q=0.9,en;q=0.8",
  "allowPrivateHosts": false,
  "cacheEnabled": true,
  "cacheTtlMs": 300000,                                   // 0–3600000, 0 = never expire
  "cacheMaxEntries": 8,                                   // 1–50
  "cacheMaxBytes": 8000000                                // 1024–50000000
}
```

## Files

| File | Purpose |
|---|---|
| `index.ts` | Tool definition, activation, rendering |
| `config.ts` | Config type, defaults, merge, clamping |
| `types.ts` | `FetchResponse` |
| `schema.ts` | TypeBox params, output schema, `resolveRequest()` |
| `http.ts` | Native-fetch runner (`HttpRunner`, errors, timeout, size cap) |
| `ssrf.ts` | URL/host validation and private-address blocking |
| `page.ts` | Fetch + content-type routing, `WebFetchError`, test runner seam |
| `find.ts` | Passage search (exact/insensitive/fuzzy) with code-point offsets |
| `cache.ts` | In-process LRU/TTL page cache |
| `extract.ts` | HTML → title + readable text |
| `format.ts` | Header, code-point slicing, truncation note |

## Testing

`test/web-fetch/` covers the fetch runner (injected `fetch`), the SSRF guard
(private/loopback/link-local/metadata, resolution failure, opt-out), extraction
(script/style/nav removal, headings/lists/links, relative URLs, entities, largest
`main`/`article`, CJK), formatting/paging, find (modes, CJK offsets, context,
limits, fuzzy), the cache (TTL, LRU by count and bytes, clear), config, and tool
registration and execution (find path, cache hits, `refresh`, `session_shutdown`
clearing, batches with partial failure, URL resolution). The runtime smoke test
only asserts registration.

## Risks

- Fetched page text is untrusted and may contain prompt-injection content; the
  tool returns it as-is.
- Heuristic extraction can miss content or include chrome; no JS rendering, PDF,
  or image support. `find` searches that same extracted text, and fuzzy mode is a
  line-level heuristic rather than a scored index.
- The page cache is in-memory and per session, so a page can be stale within a
  session; `refresh: true` refetches, and the cache is cleared on shutdown.
- The SSRF guard is best-effort: DNS can change between the check and the
  request, and `fetch` follows redirects internally.
