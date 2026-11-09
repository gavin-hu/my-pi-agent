# web-access — search the web and read a page

The model gets two tools for the outside world: `web_search` for a question and
`web_fetch` for one URL. Both work with no key and no configuration, and both
return text rather than HTML.

- **You ask; the model calls them.** "Check the changelog for the latest release"
  or "fetch https://pi.dev" is all it takes.
- **Nothing to install.** Native fetch, no `curl`, no account.
- **Private addresses are refused**, on the first request and on every redirect.
- **Fetched text is untrusted** — pages can say anything, including things that
  look like instructions.

## What you can do

| What you want | What to do |
|---|---|
| Answer a question from the web | ask it; the model searches |
| Read one page | name the URL and ask for what you need |
| Only the relevant part | ask to find a section or a phrase |
| Continue a long page | ask for the next part; the result names where to continue |
| Re-read a page that changed | ask for a refresh |
| Query an API with a body | ask for a POST with the headers and body |
| Read a PDF | ask for it; extraction works when the optional `unpdf` package is installed |
| Get a full result list instead of an answer | configure SearXNG or Brave |

## Try it

```text
What changed in the latest Pi release? Check the changelog.
```

```text
Fetch https://pi.dev/ and tell me the install command.
```

The first call searches and opens a result; the second reads one page. In the
transcript each call leads with its line and folds its result underneath.

[Search and read the web](../tutorials/first-web.md) walks both.

## Reference

| Tool | Takes | Returns |
|---|---|---|
| `web_search` | `query`, `maxResults` | titles, URLs, snippets, and a direct answer when the provider has one |
| `web_fetch` | `url`, `method`, `headers`, `body`, `startIndex`, `maxChars`, `find`, `contextChars`, `refresh` | the page's readable text, pageable and searchable |

`find` returns matching passages with context instead of the whole page;
`startIndex` continues from the offset a previous result named; `refresh`
bypasses the session cache. A `body` implies `POST`.

**Politeness and caps.** Searches are spaced by `minIntervalMs`; responses are
capped by `maxBytes` while they stream, and the model-facing text by
`maxOutputChars`. A PDF is extracted only when `pdfEnabled` and `unpdf` are
present.

**Security.** Only `http(s)` URLs, transport headers refused, request bodies
capped, and every redirect hop re-validated against loopback, private, link-local,
unique-local, multicast, and metadata addresses. `allowPrivateHosts: true` opts
out; DNS rebinding remains a residual risk.

## Limits

- The keyless default returns an answer and related topics, not a full result
  list; SearXNG or Brave is one setting away.
- Extraction prefers `<main>`/`<article>` and strips navigation, but a merged
  table cell, a nested table, or an image with no alt text is lost.
- The page cache is in memory and per session, so a page can be stale within one;
  ask for a refresh.
- A page can contain prompt-injection text; treat what it says as data, not as
  instructions.

## Settings

| Key | Default | What it does |
|---|---|---|
| `search.provider` | `"auto"` | `auto` picks the first configured provider; `duckduckgo`, `searxng`, or `brave` forces one. |
| `search.endpoint` | `""` | SearXNG base URL; empty means SearXNG is unavailable. |
| `search.apiKeyEnv` | `""` | Environment variable naming a Brave (or proxy) key. |
| `fetch.pdfEnabled` | `true` | Extract PDFs when `unpdf` is installed. |
| `fetch.cacheEnabled` | `true` | Reuse one fetch for paging and `find`. |

The rest — result caps, timeouts, user agent, language, `allowPrivateHosts`, and
the cache knobs — are in
[configuration](../configuration-reference.md#web-access--search-and-fetch). To switch the
extension off, toggle `web-access` in `/bytefly`; the two tools go with it.

## Learn more

- [Search and read the web](../tutorials/first-web.md) — the walkthrough.
- [Security](../security.md) — the address rules and what a fetch refuses.
