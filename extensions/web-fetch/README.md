# web-fetch — read web pages as text

A small `web_fetch` tool: fetch a URL with native `fetch`, convert HTML to
readable text, and page long pages. Dependency-free (no `curl`), and it refuses
private/internal targets.

```
pi --extension ./extensions/web-fetch    # load just this extension
pi -e .                                  # load the whole @gavin-hu/my-pi-agent package
pi install ./                            # or install the package
```

## What it does

- GETs an http(s) URL and returns its readable text. HTML is converted to plain
  text with links kept as `[text](url)`; JSON/text/XML is returned as-is; binary
  content is reported by type and size.
- Long pages are paged. When the result is truncated it includes the
  `startIndex` to use on the next call.
- `find` returns matching passages with code-point offsets (exact,
  case-insensitive, or fuzzy) instead of the whole page.
- Fetched pages are cached in-process for the session, so paging and `find` do
  not refetch; `refresh: true` forces a refetch.
- Loopback, private, link-local, and cloud-metadata addresses are refused.

Examples:

```
web_fetch({ url: "https://pi.dev/" })
web_fetch({ url: "https://en.wikipedia.org/wiki/Go_(programming_language)", maxChars: 4000 })
web_fetch({ url: "https://example.com/long-article", startIndex: 20000 })
web_fetch({ url: "https://pi.dev/", find: ["documentation", "extensions"], mode: "insensitive" })
```

| Parameter | Type | Notes |
|---|---|---|
| `url` | string | Absolute http(s) URL, required |
| `startIndex` | integer | Code-point offset to start from (default 0) |
| `maxChars` | integer | ≥200; defaults to and is capped by `maxOutputChars` |
| `find` | string[] | 1–10 strings; return matching passages instead of the page |
| `mode` | enum | `insensitive` (default) \| `exact` \| `fuzzy` |
| `contextChars` | integer | 0–2000 chars of context per match (default 200) |
| `maxMatches` | integer | 1–50 matches (default 8) |
| `refresh` | boolean | Bypass the cache and refetch |

## Configuration

Merged from `~/.pi/agent/web-fetch.json` (global) and
`<cwd>/.pi/web-fetch.json` (project, wins). Missing or malformed files are
ignored.

```jsonc
{
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
```

## Limitations

- **Heuristic extraction**: it strips scripts/styles/nav/footer and prefers
  `<main>`/`<article>`, but is not a full readability engine and can miss content
  or include chrome. No JavaScript rendering.
- **`find` runs on extracted text**, not raw HTML, so it will not match markup;
  fuzzy mode is line-level term coverage, not a scored full-text index.
- **The cache is in-memory and per session**: a page fetched earlier in the
  session may be stale; use `refresh: true` to refetch. It is cleared on
  `session_shutdown`.
- **Text only**: PDFs, images, and other binary content are reported, not
  extracted.
- **Untrusted content**: page text may contain prompt-injection attempts; treat
  it as data, not instructions.
- The SSRF guard is best-effort (DNS rebinding and internal redirects are not
  fully covered).

See [`DESIGN.md`](./DESIGN.md) for the implementation and test layout.
