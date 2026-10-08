# web-access — model-facing web access for Pi

One extension, two tools, keyless and dependency-free (native `fetch`, no
`curl`):

- **`web_search`** — look up a fact, definition, or topic via DuckDuckGo Instant
  Answers with a Wikipedia fallback.
- **`web_fetch`** — fetch one or more URLs and return readable text, with paging,
  `find`, and an SSRF guard.

Both are `direct` and active by default. They read one config file,
`web-access.json`, with a `search` section and a `fetch` section.

```
pi --extension ./extensions/web-access    # load just this extension
pi -e .                                   # load the whole @gavin-hu/my-pi-agent package
pi install ./                             # or install the package
```

## `web_search`

Instant answers and encyclopedia snippets only — **not a general web search
engine**. For a specific page, use `web_fetch`.

| Parameter | Type | Notes |
|---|---|---|
| `query` | string | 1–400 chars, required, any language |
| `maxResults` | integer | 1–20, capped by the configured maximum (default 8) |
| `source` | enum | `auto` (default) \| `wikipedia` \| `instant` |

Wikipedia search operators are passed straight to `gsrsearch`: `intitle:`,
`incategory:`, `insource:`, `prefix:`, `hastemplate:`, and friends. With
`source: "auto"` an operator query skips the instant-answer lookup.

```
web_search({ query: "what is the capital of Portugal" })
web_search({ query: "广州 早茶 文化" })           // Han text → zh Wikipedia fallback
web_search({ query: "python list comprehension", maxResults: 3 })
web_search({ query: "intitle:早茶 广州", source: "wikipedia" })
```

## `web_fetch`

GETs one or more http(s) URLs and returns readable text. HTML becomes plain text
with links kept as `[text](url)`; JSON/text/XML is returned as-is; binary content
is reported by type and size. Loopback, private, link-local, and cloud-metadata
addresses are refused.

| Parameter | Type | Notes |
|---|---|---|
| `url` | string | Absolute http(s) URL, required unless `urls` is given |
| `urls` | string[] | 1–5 URLs fetched sequentially in one call |
| `startIndex` | integer | Code-point offset to start from, applied to every page (default 0) |
| `maxChars` | integer | ≥200; split across pages and capped by `maxOutputChars` |
| `find` | string[] | 1–10 strings; return matching passages instead of the page |
| `mode` | enum | `insensitive` (default) \| `exact` \| `fuzzy` |
| `contextChars` | integer | 0–2000 chars of context per match (default 200) |
| `maxMatches` | integer | 1–50 matches (default 8) |
| `refresh` | boolean | Bypass the page cache and refetch |

Long pages are paged: a truncated result reports the `startIndex` to use next.
Fetched pages are cached in-process for the session, so paging and `find` do not
refetch. `structuredContent` is `{ pages: [...] }`, one entry per URL (with an
`error` field when a page failed).

```
web_fetch({ url: "https://pi.dev/" })
web_fetch({ url: "https://example.com/long-article", startIndex: 20000 })
web_fetch({ url: "https://pi.dev/", find: ["documentation", "extensions"] })
web_fetch({ urls: ["https://a.example/", "https://b.example/"] })
```

## Configuration

Merged from `~/.pi/agent/web-access.json` (global) and
`<cwd>/.pi/web-access.json` (project, wins). Missing or malformed files and
unknown keys are ignored.

```jsonc
{
  "search": {
    "maxResults": 8,                                        // 1–20
    "timeoutMs": 15000,                                     // 1000–120000
    "maxBytes": 5000000,                                    // response size cap
    "minIntervalMs": 500,                                   // spacing between requests
    "maxOutputChars": 12000,                                // model-facing budget
    "userAgent": "my-pi-agent/0.1 (+https://github.com/gavin-hu/my-pi-agent)",
    "wikipediaLang": "auto",                                // "auto" | language code
    "instantAnswerEndpoint": "https://api.duckduckgo.com/",
    "wikipediaEndpoint": "https://{lang}.wikipedia.org/w/api.php"
  },
  "fetch": {
    "timeoutMs": 20000,                                     // 1000–120000
    "maxBytes": 5000000,                                    // response size cap
    "maxOutputChars": 20000,                                // default/ceiling for maxChars
    "userAgent": "my-pi-agent/0.1 (+https://github.com/gavin-hu/my-pi-agent)",
    "acceptLanguage": "zh-CN,zh;q=0.9,en;q=0.8",
    "allowPrivateHosts": false,                             // true disables the SSRF guard
    "cacheEnabled": true,
    "cacheTtlMs": 300000,                                   // 0 = never expire
    "cacheMaxEntries": 8,
    "cacheMaxBytes": 8000000
  }
}
```

Set `"wikipediaLang": "zh"` (or any code) to force a Wikipedia language; the
default `"auto"` uses `zh` for Han text and `en` otherwise.

## Limitations

- **Sparse instant answers**: `web_search` returns no general web results, news,
  or images; niche queries may have none. Use `web_fetch` for pages.
- **Heuristic extraction**: `web_fetch` strips scripts/styles/nav/footer and
  prefers `<main>`/`<article>`, but is not a full readability engine. No
  JavaScript rendering or PDF extraction.
- **The cache is in-memory and per session**; a page can be stale within a
  session. `refresh: true` refetches, and it is cleared on `session_shutdown`.
- **Untrusted content**: fetched page text may contain prompt-injection attempts;
  treat it as data, not instructions.
- The SSRF guard is best-effort (DNS rebinding and internal redirects are not
  fully covered).

See [`DESIGN.md`](./DESIGN.md) for the implementation and test layout.
