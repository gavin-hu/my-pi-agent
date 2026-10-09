# web-access — model-facing web access for Pi

One extension, two tools, keyless and dependency-free (native `fetch`, no
`curl`): `web_search` runs general web search through a pluggable provider
(keyless DuckDuckGo by default; optional SearXNG or Brave), and `web_fetch`
reads one or more URLs as text. Both are `direct` and active by default, and
read one config file, `web-access.json`.

```
pi --extension ./extensions/web-access    # load just this extension
pi -e .                                   # load the whole @gavin-hu/my-pi-agent package
pi install ./                             # or install the package
```

## What it does

- Registers `web_search`, general web search through a pluggable provider:
  keyless DuckDuckGo by default, or a self-hosted SearXNG instance / keyed Brave
  search. Returns titles, URLs, snippets, and a direct answer when available,
  always with no configuration required.
- Registers `web_fetch`, which fetches one or more URLs (GET or POST) and
  returns readable text with links kept as `[text](url)`.
- Pages long output and reports the next `startIndex`; `find` returns matching
  passages instead of the whole page.
- Re-validates every redirect hop against private/internal addresses, and
  refuses transport headers and oversized bodies.
- Optionally extracts PDFs (`unpdf`) and renders JavaScript-heavy pages
  (`playwright`); both packages load lazily and are never required.
- Caches fetched pages in-process for the session, so paging and `find` do not
  refetch; the cache is cleared on `session_shutdown`.

## Tools

| Tool | What it does |
|---|---|
| `web_search` | General web search; keyless by default, SearXNG or Brave optional. |
| `web_fetch` | Fetch URLs and return readable text, pageable and searchable. |

```
web_search({ query: "pi coding agent" })
web_fetch({ url: "https://pi.dev/" })
web_fetch({ urls: ["https://a.example/", "https://b.example/"] })
web_fetch({ url: "https://pi.dev/", find: ["documentation", "extensions"] })
```

### Transcript

The call line names the query or URL. The result separates the header from its
body and sanitizes untrusted web text (answers, titles, fetched titles and
errors) to one line before it reaches the terminal.

```
web_search "pi coding agent" (8 results)

via searxng · 8 results
Pi is a coding agent harness …
1. Pi — a coding agent harness
2. GitHub - earendil-works/pi
+3 more
```

```
web_fetch https://pi.dev/
Pi — a coding-agent component · 12k chars (cached)
```

## Configuration

Merged from `~/.pi/agent/web-access.json` (global) and
`<cwd>/.pi/web-access.json` (project, wins). Missing or malformed files and
unknown keys are ignored.

```jsonc
{
  "search": {
    "provider": "auto",                                    // "auto" | "duckduckgo" | "searxng" | "brave"
    "endpoint": "http://localhost:8080",                   // SearXNG base URL; "" means SearXNG is unavailable
    "language": "auto",                                     // SearXNG: "auto" (zh-CN for Han, else en) | language code
    "safeSearch": 0,                                        // SearXNG: 0 off, 1 moderate, 2 strict
    "categories": "general",                                // SearXNG categories
    "apiKeyEnv": "",                                        // env var naming a key (Brave, or an auth proxy)
    "apiKey": "",                                           // literal fallback key
    "maxResults": 8,                                        // 1–20
    "timeoutMs": 15000,                                     // 1000–120000
    "maxBytes": 5000000,                                    // response size cap
    "minIntervalMs": 500,                                   // spacing between requests
    "maxOutputChars": 12000,                                // model-facing budget
    "userAgent": "my-pi-agent/0.1 (+https://github.com/gavin-hu/my-pi-agent)"
  },
  "fetch": {
    "timeoutMs": 20000,                                     // 1000–120000
    "maxBytes": 5000000,                                    // response size cap
    "maxOutputChars": 20000,                                // default/ceiling for maxChars
    "userAgent": "my-pi-agent/0.1 (+https://github.com/gavin-hu/my-pi-agent)",
    "acceptLanguage": "zh-CN,zh;q=0.9,en;q=0.8",
    "allowPrivateHosts": false,                             // true disables the SSRF guard
    "maxRedirects": 5,                                      // 0–10 hops, each re-validated
    "maxBodyChars": 100000,                                 // request body cap (POST)
    "pdfEnabled": true,                                     // extract PDFs (needs unpdf)
    "renderJs": "never",                                    // "never" | "auto" | "always" (needs playwright)
    "renderTimeoutMs": 15000,                               // 1000–120000
    "renderWaitUntil": "load",                              // "load" | "networkidle"
    "renderMinChars": 500,                                  // "auto" renders below this length
    "renderExecutablePath": "",                             // optional Chromium path
    "cacheEnabled": true,
    "cacheTtlMs": 300000,                                   // 0 = never expire
    "cacheMaxEntries": 8,
    "cacheMaxBytes": 8000000
  }
}
```

`search.language`, `safeSearch`, and `categories` apply to the SearXNG provider
only. `apiKeyEnv` names an environment variable holding a key (preferred);
`apiKey` is a literal fallback. For SearXNG behind an auth proxy the key is sent
as `Authorization: Bearer <key>`; for Brave it is sent as
`X-Subscription-Token`.

## Security

- Fetched page text and search snippets are untrusted and may contain
  prompt-injection content; both tools return it as-is.
- **Transcript sanitization.** The web strings the transcript draws (search
  answers and titles, fetched page titles and errors, URLs and `find` terms) are
  collapsed to one sanitized line before a theme colour is applied, so control
  characters from a page cannot restyle or corrupt the terminal.
- `web_fetch` requires http(s), rejects obvious internal hostnames, and refuses
  any host that resolves to a loopback, RFC1918, link-local, unique-local,
  multicast, or metadata address. `allowPrivateHosts: true` opts out.
- Redirects are followed manually and every hop is re-validated, so a public URL
  cannot redirect into a private address.
- Transport headers (`Host`, `Content-Length`, `Connection`, `Transfer-Encoding`,
  and similar) are refused, and request bodies are capped.
- The JS renderer uses the browser's own network stack, so its subresource
  requests are guarded best-effort (`page.route` blocks known-internal targets)
  and not by the full transport guard; DNS rebinding is a residual risk.

## `web_search`

`web_search` runs through one pluggable provider, selected by `search.provider`
(`"auto"` by default).

| Provider | Transport | Configuration | Returns |
|---|---|---|---|
| `duckduckgo` | Instant Answer JSON API, keyless | none | a direct answer and related topics — **not** a general result list |
| `searxng` | SearXNG JSON API (`format=json`) | `search.endpoint` | general results (title/URL/snippet) and answers |
| `brave` | Brave Search API, keyed | `search.apiKeyEnv` / `search.apiKey` | general results |

Under `"auto"`, the first configured non-default provider wins — SearXNG when
`endpoint` is set, else Brave when a key is set — and otherwise the keyless
DuckDuckGo provider is used, so `web_search` always works with no configuration.
There is **no failover**: exactly one provider runs, and a failure is reported.

Honest limitation of the keyless default: DuckDuckGo's Instant Answer API returns
answers and related topics, not a paginated list of web results. For full result
lists, configure SearXNG or Brave.

The SearXNG instance must have the **JSON API enabled** (`format=json` in its
`settings.yml`); most public instances disable it, so a self-hosted instance is
recommended. If the response is not JSON, the error says so.

| Parameter | Type | Notes |
|---|---|---|
| `query` | string | 1–400 chars, required, any language |
| `maxResults` | integer | 1–20, capped by the configured maximum (default 8) |

```
web_search({ query: "pi coding agent" })
web_search({ query: "广州 早茶 文化" })           // Han text → SearXNG language zh-CN
web_search({ query: "python list comprehension", maxResults: 3 })
```

## `web_fetch`

GETs (or POSTs) one or more http(s) URLs and returns readable text. HTML becomes
plain text with links kept as `[text](url)`; JSON/text/XML is returned as-is;
PDFs are text-extracted when the optional `unpdf` package is installed; other
binary content is reported by type and size. Redirects are followed manually and
**every hop is re-validated**, so a public URL cannot redirect into a private
address. Loopback, private, link-local, and cloud-metadata addresses are refused.

| Parameter | Type | Notes |
|---|---|---|
| `url` | string | Absolute http(s) URL, required unless `urls` is given |
| `urls` | string[] | 1–5 URLs fetched sequentially in one call |
| `method` | enum | `GET` (default) \| `POST`. POST is for read-style APIs |
| `headers` | object | Extra request headers (transport headers are refused) |
| `body` | string | POST body; implies `method: "POST"` unless set explicitly |
| `render` | boolean | Force/forbid JS rendering for this call, overriding `renderJs` |
| `startIndex` | integer | Code-point offset to start from, applied to every page (default 0) |
| `maxChars` | integer | ≥200; split across pages and capped by `maxOutputChars` |
| `find` | string[] | 1–10 strings; return matching passages instead of the page |
| `mode` | enum | `insensitive` (default) \| `exact` \| `fuzzy` |
| `contextChars` | integer | 0–2000 chars of context per match (default 200) |
| `maxMatches` | integer | 1–50 matches (default 8) |
| `refresh` | boolean | Bypass the page cache and refetch |

Long pages are paged: a truncated result reports the `startIndex` to use next.
Fetched pages are cached in-process for the session, so paging and `find` do not
refetch. POST responses and requests with custom headers are never cached.
`structuredContent` is `{ pages: [...] }`, one entry per URL (with an `error`
field when a page failed, and `rendered` when JS rendering ran).

```
web_fetch({ url: "https://pi.dev/" })
web_fetch({ url: "https://example.com/long-article", startIndex: 20000 })
web_fetch({ url: "https://pi.dev/", find: ["documentation", "extensions"] })
web_fetch({ urls: ["https://a.example/", "https://b.example/"] })
web_fetch({ url: "https://api.example/graphql", method: "POST", headers: { "Content-Type": "application/json" }, body: '{"query":"{ viewer { login } }"}' })
web_fetch({ url: "https://spa.example/", render: true })
```

### Optional dependencies

PDF extraction and JS rendering need packages that are not installed by
default; both are loaded lazily, so the extension stays dependency-free until
you enable them.

| Feature | Package | Enable |
|---|---|---|
| PDF text extraction | `unpdf` | `npm i unpdf` (on by default once installed) |
| JS rendering | `playwright` | `npm i playwright && npx playwright install chromium`, then `"renderJs": "auto"` or `"always"` |

When a package is missing, `render: true` / `renderJs: "always"` returns an
actionable error, while `renderJs: "auto"` and the PDF path fall back to the
plain behavior. The renderer uses the browser's own network stack, so its
subresource requests are guarded best-effort (blocked hostnames and IP literals)
but not by the full transport guard.

## Limitations

- **SearXNG needs the JSON API enabled.** `web_search` runs keyless by default
  (DuckDuckGo Instant Answer), which returns answers and related topics rather
  than a general result list; configure `search.endpoint` for a self-hosted
  SearXNG or `search.apiKeyEnv` for Brave to get full web results. Result quality
  follows the engines the provider uses.
- **Heuristic extraction**: `web_fetch` strips scripts/styles/nav/footer and
  prefers `<main>`/`<article>`, but is not a full readability engine. JS
  rendering and PDF extraction are optional (`playwright`/`unpdf`) and off unless
  installed and enabled.
- **The page cache is in-memory and per session**; a page can be stale within a
  session. `refresh: true` refetches, and it is cleared on `session_shutdown`.
- **Untrusted content**: fetched page text may contain prompt-injection attempts;
  treat it as data, not instructions.
- The SSRF guard covers every redirect hop, but DNS rebinding and the renderer's
  own subresource requests are only best-effort.

## Non-goals

- `web_search` does not scrape a search-results page: each provider speaks a
  JSON API (DuckDuckGo Instant Answer, SearXNG, or Brave). No keys are required
  for the keyless default.
- `web_fetch` does no model call; it returns text and lets the model reason.
- JavaScript rendering and PDF extraction exist only through optional, lazily
  loaded packages, never as required dependencies.

## Pi integration

| Integration point | Value |
|---|---|
| Tools | `web_search`, `web_fetch`; `exposure: "direct"`, both `defaultActive: true` |
| Execution mode | `web_search`: `sequential`; `web_fetch`: default |
| Annotations | both `readOnlyHint: true`, `openWorldHint: true`, `destructiveHint: false` |
| Output | `outputSchema` (`WebSearchOutput` / `WebFetchOutput`) plus matching `structuredContent` |
| State | none in the session branch; in-process fetch page cache only (`web_search` keeps a per-instance throttle) |
| Lifecycle | factory registers the tools; `session_shutdown` clears the fetch cache |

## Design notes

- **Two self-contained halves.** `search/` and `fetch/` each own their
  `config.ts`, `schema.ts`, `types.ts`, `format.ts`, and `tool.ts`, and do not
  import each other; `index.ts` only registers and clears the cache.
- **Shared transport.** [`http.ts`](./http.ts) holds the fetch runner
  (`HttpRunner`, `createFetchRunner`, HTTP error types), used by both halves and
  injectable for tests.
- **One config file, isolated sections.** `config.ts` reads the global then
  project file and validates each section with its half's normalizer; unknown
  keys and malformed files are ignored.
- **Native fetch, no required dependencies.** PDF and JS rendering load lazily;
  the renderer only runs under `render: true`, `"always"`, or `"auto"` when
  extracted text is shorter than `renderMinChars`, and `"auto"` falls back to
  raw HTML on failure.
- **Per-hop SSRF validation.** Redirects are followed with `redirect: "manual"`
  under one shared deadline, re-resolving and re-checking each `Location`.
- **Pluggable search providers.** [`registry.ts`](./search/registry.ts) holds a
  value-only provider list (`duckduckgo`, `searxng`, `brave`) and a pure
  `resolveProvider`; [`search.ts`](./search/search.ts) owns selection, key
  resolution, a per-instance throttle, and error mapping. A provider with no
  answer and no results reports `provider: "none"`.
- **Find-in-page.** `exact` is case-sensitive, `insensitive` lowercases both
  sides, and `fuzzy` scores lines by the fraction of query terms they contain
  (a spaceless CJK term expands to its characters), keeping lines ≥ 50%.
  Offsets line up with `startIndex` so a hit can be read with a second call.
- **Page cache.** [`fetch/cache.ts`](./fetch/cache.ts) is an in-process LRU/TTL
  keyed by requested URL, holding extracted pages so paging and find are a
  single fetch; entries evict by count and total bytes.
- **Transcript sanitization and reuse.** [`transcript.ts`](./transcript.ts)
  holds `oneLine`, shared by both tools to collapse untrusted web text to one
  sanitized, optionally clipped line; the renderers reuse
  `context.lastComponent` instead of allocating each render.

## Files

| File | Purpose |
|---|---|
| `index.ts` | Register both tools; clear the fetch cache on shutdown |
| `config.ts` | Nested `web-access.json` loader |
| `http.ts` | Shared fetch runner and HTTP error types |
| `transcript.ts` | Shared `oneLine` sanitizer for both transcript renderers |
| `search/tool.ts` | `web_search` definition, activation, rendering |
| `search/provider.ts` | Provider interface (`SearchProvider`, `ProviderContext`) |
| `search/registry.ts` | Value-only provider list, `resolveProvider`, labels |
| `search/config.ts` | Search config type, defaults, clamping, API-key resolution |
| `search/schema.ts` | Params/output schema, `resolveRequest()` |
| `search/search.ts` | Provider resolution, throttle, and outcome mapping |
| `search/providers/duckduckgo.ts` | Keyless Instant Answer JSON provider |
| `search/providers/searxng.ts` | SearXNG URL builder, response parser, and client |
| `search/providers/brave.ts` | Brave keyed JSON provider |
| `search/json.ts` | Defensive JSON narrowing shared by the parsers |
| `search/format.ts`, `search/types.ts` | Result text and data types |
| `fetch/tool.ts` | `web_fetch` definition, activation, rendering |
| `fetch/config.ts` | Fetch config type, defaults, clamping |
| `fetch/schema.ts` | Params/output schema, `resolveRequest()` |
| `fetch/page.ts` | Fetch + redirect-following + content-type routing, test runner seam |
| `fetch/ssrf.ts` | URL/host validation and private-address blocking |
| `fetch/extract.ts` | HTML → title + readable text |
| `fetch/pdf.ts` | Optional PDF text extraction via lazy `unpdf` (test seam) |
| `fetch/render.ts` | Optional JS rendering via lazy `playwright` (test seam) |
| `fetch/find.ts` | Passage search (exact/insensitive/fuzzy) |
| `fetch/cache.ts` | In-process LRU/TTL page cache |
| `fetch/format.ts`, `fetch/types.ts` | Result text and data types |

## Testing

`extensions/web-access/` mirrors the halves (`search/`, `fetch/`) plus top-level
`config.test.ts` and `index.test.ts`. It covers the shared runner (via injected
`fetch`), the provider registry and resolution, each provider's URL builder and
parser (DuckDuckGo, SearXNG, Brave), the orchestration pipeline and throttle,
redirect re-validation (per-hop SSRF with literal IPs), method/header/body
validation, the nested config merge and section isolation, extraction,
formatting/paging, find, the cache, the SSRF guard, the optional PDF/render
seams, and both tools' registration/execution. Tests inject the runner, throttle,
PDF extractor, and renderer, so no network, browser, or PDF library is needed;
the runtime smoke test only asserts registration.
