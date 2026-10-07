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
- No shared HTTP library with `web-search`: each extension stays self-contained,
  at the cost of a small duplicated fetch runner.

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
  url: string,          // absolute http(s), required
  startIndex?: number,  // code-point offset, default 0
  maxChars?: number,    // ≥200, capped by config.maxOutputChars
})
```

### Result

`content` is a header (`Title`, `URL`, `Status`) plus the text slice, with a
trailing note when truncated. `details`/`structuredContent`:

```ts
{ url, finalUrl, title, status, contentType, text, totalChars, startIndex, truncated, fetchedAt }
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
   and reports the next index.

### Extraction

[`extract.ts`](./extract.ts) is a heuristic readability pass, not a DOM parser:
it drops comments and `script/style/noscript/template/svg/iframe/form/nav/footer/
header/aside`, prefers the largest `<main>`/`<article>` else `<body>`, converts
headings to `#`, list items to `-`, links to `[text](absolute-url)`, images to
their alt text, decodes entities, and collapses whitespace. CJK passes through.

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
  "allowPrivateHosts": false
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
| `extract.ts` | HTML → title + readable text |
| `format.ts` | Header, code-point slicing, truncation note |

## Testing

`test/web-fetch/` covers the fetch runner (injected `fetch`), the SSRF guard
(private/loopback/link-local/metadata, resolution failure, opt-out), extraction
(script/style/nav removal, headings/lists/links, relative URLs, entities, largest
`main`/`article`, CJK), formatting/paging, config, and tool registration and
execution. The runtime smoke test only asserts registration.

## Risks

- Fetched page text is untrusted and may contain prompt-injection content; the
  tool returns it as-is.
- Heuristic extraction can miss content or include chrome; no JS rendering, PDF,
  or image support.
- The SSRF guard is best-effort: DNS can change between the check and the
  request, and `fetch` follows redirects internally.
