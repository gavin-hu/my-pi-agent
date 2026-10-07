# web-search — keyless web lookup for Pi

A small `web_search` tool: DuckDuckGo Instant Answers first, Wikipedia as a
fallback. Keyless, dependency-free, and fetch-only (no `curl`), and it works for
Chinese and English.

```
pi --extension ./extensions/web-search    # load just this extension
pi -e .                                   # load the whole @gavin-hu/my-pi-agent package
pi install ./                             # or install the package
```

## What it does

- `web_search` looks up a fact, definition, or topic and returns an instant
  answer (when there is one) plus numbered results — title, URL, snippet.
- It is **not a general web search engine**: it cannot return arbitrary web
  results. For a specific page, use [`web_fetch`](../web-fetch/) or your network
  tools.

Example queries:

```
web_search({ query: "what is the capital of Portugal" })
web_search({ query: "广州 早茶 文化" })           // Han text → zh Wikipedia fallback
web_search({ query: "python list comprehension", maxResults: 3 })
```

| Parameter | Type | Notes |
|---|---|---|
| `query` | string | 1–400 chars, required, any language |
| `maxResults` | integer | 1–20, capped by the configured maximum (default 8) |

## Configuration

Merged from `~/.pi/agent/web-search.json` (global) and
`<cwd>/.pi/web-search.json` (project, wins). Missing or malformed files are
ignored.

```jsonc
{
  "maxResults": 8,                                        // 1–20
  "timeoutMs": 15000,                                     // 1000–120000
  "maxBytes": 5000000,                                    // response size cap
  "minIntervalMs": 500,                                   // spacing between requests
  "maxOutputChars": 12000,                                // model-facing budget
  "userAgent": "my-pi-agent/0.1 (+https://github.com/gavin-hu/my-pi-agent)",
  "wikipediaLang": "auto",                                // "auto" | language code
  "instantAnswerEndpoint": "https://api.duckduckgo.com/",
  "wikipediaEndpoint": "https://{lang}.wikipedia.org/w/api.php"
}
```

Set `"wikipediaLang": "zh"` (or any code) to force a Wikipedia language; the
default `"auto"` uses `zh` for Han text and `en` otherwise.

## Limitations

- **Instant Answers are sparse by design.** Niche or non-factual queries often
  have no instant answer; Wikipedia then covers topics, but there are still
  queries with no result. Use `web_fetch` for pages.
- **No general web results, news, or images.**
- Requires network access; no caching.

See [`DESIGN.md`](./DESIGN.md) for the implementation and test layout.
