# web-search — keyless web search for Pi

A small `web_search` tool backed by DuckDuckGo's classic HTML endpoint. No API
key, no npm dependencies, works for Chinese and English queries. Requests are
sent with the `curl` binary, because DuckDuckGo challenges Node/Bun `fetch`
clients but accepts curl.

```
pi --extension ./extensions/web-search    # load just this extension
pi -e .                                   # load the whole @gavin-hu/my-pi-agent package
pi install ./                             # or install the package
```

## What it does

- `web_search` returns ranked results — title, URL, and snippet — as numbered
  text, with the same data in `details`/`structuredContent` for codemode.
- `direct` exposure and active by default; also callable from codemode scripts.
- Runs sequentially and spaces requests out, so it does not hammer DuckDuckGo.

Example queries:

```
web_search({ query: "gavin-hu my-pi-agent" })
web_search({ query: "广州 早茶 推荐", region: "cn-zh", maxResults: 10 })
web_search({ query: "git worktree detach HEAD", safeSearch: "off", maxResults: 5 })
```

| Parameter | Type | Notes |
|---|---|---|
| `query` | string | 1–400 chars, required, any language |
| `maxResults` | integer | 1–20, capped by the configured maximum (default 8) |
| `region` | string | `wt-wt` (any) or `xx-xx`, e.g. `cn-zh`, `us-en` |
| `safeSearch` | enum | `strict` \| `moderate` \| `off` |

Results are snippets only. To read a page, open its URL with your file/network
tools.

## Configuration

Merged from `~/.pi/agent/web-search.json` (global) and
`<cwd>/.pi/web-search.json` (project, wins). Missing or malformed files are
ignored.

```jsonc
{
  "maxResults": 8,                               // 1–20
  "region": "wt-wt",                             // no region: mixes zh + en
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

For English-biased results set `"region": "us-en"`; for Chinese sites prefer
`"region": "cn-zh"`. The default `wt-wt` lets DuckDuckGo auto-detect the query
language and is the best bilingual choice.

## Chinese and English

DuckDuckGo is Bing-index-backed and auto-detects query language, so both work
well. It is still weaker than Baidu for mainland-China long-tail/local content,
and it has no Baidu or WeChat index.

## Limitations

- **Keyless scraping**: DuckDuckGo can serve an anti-bot challenge from some
  networks. The tool detects it and reports a clear error instead of returning
  nothing. Wait a moment before retrying, or raise `minIntervalMs`, if it happens.
- **Requires curl**: requests shell out to `curl` (set `curlPath` if it is not
  on `PATH`). This is deliberate — DuckDuckGo serves Node/Bun `fetch` clients the
  challenge even when the headers match.
- **Classic HTML endpoint only**: no JS rendering, no news/images, no full page
  content — results are titles, URLs, and snippets.
- **No caching**: every call fetches again; the only shared state is the
  politeness timestamp.

See [`DESIGN.md`](./DESIGN.md) for the implementation and test layout.
