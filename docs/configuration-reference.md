# Configuration reference

Every key `bytefly.json` accepts, section by section. Resolution, migration, and
the state and environment files live in [Configuration](./configuration.md).

Two conventions:

- The key column is the dotted path inside the section, so `currency.decimals`
  under `price` is the document's `price.currency.decimals`.
- A key whose value is a free-form map or an array of objects gets one row, and
  its child shape is described under the table.

Every section is checked against the defaults its loader exports by
`test/config-docs.test.ts`, so a renamed key or a changed default fails the
suite; each extension's own `README.md` remains the place for behaviour beyond
the keys.

## Document metadata

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `$schema` | string | | | Editor-schema pointer; ignored by the loaders. |
| `version` | integer | `1` | `1` or newer | Document schema version; a newer value warns, an older one is read as-is. |

## `price` — cost calculation

The footer's cost total. Read once per footer install, so a change needs a
reload. `/bytefly settings` edits `currency.code`, `currency.symbol`,
`currency.decimals`, and `fallbackToRecordedCost`.

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `currency.code` | string | `"CNY"` | `CNY`, `USD` | Pricing algorithm: `CNY` uses `rates` and `peak`; `USD` totals Pi's recorded cost and ignores both. |
| `currency.symbol` | string | `"¥"` | Up to 4 characters | Symbol shown before the amount. |
| `currency.decimals` | integer | `2` | `0`–`4` | Digits after the decimal point. |
| `fallbackToRecordedCost` | boolean | `true` | | In `CNY` mode, show Pi's recorded USD cost for a model with no matching rate instead of no total. |
| `rates` | object | DeepSeek's published rates | One entry per `provider/model` | Per-million-token prices; merged key by key across the global and project documents. |
| `peak.timezone` | string | `"Asia/Shanghai"` | An IANA zone | Zone the peak windows are stated in; an unknown zone drops the whole schedule. |
| `peak.windows` | array | DeepSeek's weekday windows | Up to 16 entries | The peak windows. |

`rates` are yuan prices for the `CNY` algorithm. Choosing a currency also writes its symbol and precision; both can be overridden
afterwards. A `rates` entry takes `input`, `output`, `cacheRead`, and `cacheWrite` (number,
`0`–`1000000`, default `0`) and `offPeakMultiplier` (number, `0`–`1`, default
`1`). A key present in both documents replaces the other. An entry stating none
of the five numbers is ignored.

A `peak.windows` entry takes `from` and `to` (`HH:MM`, both required) and `days`
(ISO weekdays `1`–`7`, `1` = Monday; omitted means every day). `from` is
inclusive, `to` exclusive, and a `to` at or before `from` wraps past midnight.

## `notify` — OS notifications

Read at `session_start`; `/bytefly settings` edits `enabled`, `method`, and
`title`.

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `enabled` | boolean | `false` | | Raise a notification at all. |
| `turnFinished` | boolean | `true` | | Announce a run that settled. |
| `needsInput` | boolean | `true` | | Announce a prompt raised during a run. |
| `jobFinished` | boolean | `true` | | Announce a finished background job. |
| `method` | string | `"auto"` | `auto`, `osc777`, `osc99`, `toast`, `osascript`, `notify-send` | Delivery route; `auto` picks from the terminal, then the platform. |
| `title` | string | `"Pi"` | Up to 40 characters | Notification title. |

An explicit `method` this host cannot deliver — a platform notifier on another
platform, or an OSC method with no terminal — is reported by `doctor` as a
`degraded` finding and is still dropped at send time; `auto` never is, because
it picks from the environment.

## `doctor` — diagnostics

Read at `session_start`; `/bytefly settings` edits `proactive`.

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `proactive` | boolean | `true` | | Probe enabled extensions at session start and post a notice for a missing requirement. |
| `timeoutMs` | integer | `2000` | `100`–`30000` | Per-probe timeout for one spawned command. |
| `skip` | string[] | `[]` | | Extension names left out of every report. |

## `chrome` — transcript chrome

The part of bytefly's look that a config file controls; `/bytefly settings` edits
`rail`.

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `rail` | string | `"╎"` | Exactly one visible column | Glyph that leads a tool result and a notice body. |

## `document` — document extraction

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `maxFileBytes` | integer | `20971520` | `1024`–`536870912` | Reject files larger than this many bytes. |
| `maxChars` | integer | `40000` | `200`–`100000` | Default character budget for the returned slice. |
| `formats.pdf` | boolean | `true` | | Enable PDF extraction. |
| `formats.docx` | boolean | `true` | | Enable DOCX extraction. |
| `formats.doc` | boolean | `true` | | Enable DOC extraction. |
| `formats.odt` | boolean | `true` | | Enable ODT extraction. |
| `formats.rtf` | boolean | `true` | | Enable RTF extraction. |
| `formats.xlsx` | boolean | `true` | | Enable XLSX extraction. |

`formats` accepts only the six ids above; an unknown id or a non-boolean value is
ignored, and an absent id keeps its registry default.

## `file-browse` — the local file server

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `port` | integer | `0` | `0`–`65535` | TCP port on `127.0.0.1`; `0` picks one random port for the session, a positive value pins it. |
| `autoOpen` | boolean | `true` | | Open the default browser when the server starts. |
| `maxFileBytes` | integer | `1048576` | `0`–`1073741824` | Files larger than this are not rendered inline. |
| `maxThumbBytes` | integer | `5242880` | `0`–`1073741824` | Images larger than this get an icon instead of a thumbnail. |
| `maxTextLines` | integer | `5000` | `1`–`1000000` | Lines rendered before a text file is truncated. |
| `maxDirEntries` | integer | `2000` | `1`–`1000000` | Directory entries listed before the listing is truncated. |
| `thumbnails` | boolean | `true` | | Render inline image thumbnails in listings. |
| `markdown` | boolean | `true` | | Render Markdown files as formatted HTML instead of plain text. |
| `maxIndexEntries` | integer | `20000` | `1`–`1000000` | Files collected for the quick-open index before it is truncated. |
| `gitDiff` | boolean | `true` | | Offer the read-only git diff view. |
| `diffContext` | integer | `3` | `0`–`100` | Unified diff context lines. |
| `maxDiffLines` | integer | `4000` | `1`–`1000000` | Diff lines rendered before the view is truncated. |

## `goal` — the goal widget

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `achieved` | string | `"hide"` | `show`, `hide` | How an achieved goal renders: `show` keeps the dimmed rail line, `hide` removes it. |

## `job` — background jobs

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `enabled` | boolean | `true` | | Track jobs at all. |
| `showStatus` | boolean | `true` | | Show the `▸ N` / `✗ N` chips while jobs run or a failure is unreported. |
| `wakeOnFinish` | boolean | `false` | | Default `wake` for a new job: trigger one agent turn when it finishes. |
| `detachedByDefault` | boolean | `false` | | Leave jobs running when the session ends unless a job opts out. |
| `maxJobs` | integer | `20` | `1`–`500` | Finished jobs kept in the registry before the oldest are pruned. |
| `maxLogLines` | integer | `100` | `1`–`5000` | Log lines returned to the model by `logs`. |
| `maxLogBytes` | integer | `8388608` | `0`–`1073741824` | Bytes a log segment may reach before it rotates to `<id>.log.1`; `0` keeps logs unbounded. |
| `killGraceMs` | integer | `5000` | `0`–`60000` | Grace period before a SIGTERM escalates to SIGKILL. |
| `repaintMs` | integer | `1000` | `100`–`10000` | Chip refresh interval while jobs run. |
| `sessionTtlMs` | integer | `60000` | `5000`–`600000` | How long a session heartbeat is trusted before its jobs are reaped. |
| `registryDir` | string | | | Override for the registry and log directory; the default sits under the agent directory. |

## `watch` — file and command watchers

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `enabled` | boolean | `true` | | Track watchers at all. |
| `showStatus` | boolean | `true` | | Show the chips while watchers run or a match is unreported. |
| `wakeOnMatch` | boolean | `false` | | Default `wake` for a new watcher: trigger one agent turn on a match. |
| `maxWatchers` | integer | `20` | `1`–`200` | Live watchers kept before `add` is refused. |
| `maxMatches` | integer | `200` | `1`–`5000` | Matches kept per watcher before the oldest are dropped. |
| `maxLogLines` | integer | `500` | `1`–`5000` | Raw lines kept per watcher for `logs`. |
| `matchLines` | integer | `50` | `1`–`2000` | Lines returned by `matches` and `logs` when the call omits a count. |
| `pollMs` | integer | `500` | `100`–`60000` | File poll interval; watchers do not use `fs.watch`. |

## `memory` — durable notes

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `inject` | boolean | `true` | | Inject stored notes before each run. |
| `maxInjectBytes` | integer | `8192` | `512`–`32768` | Largest injected body, in UTF-8 bytes. |

## `rewind` — snapshots

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `autoSnapshots` | boolean | `true` | | Take one automatic snapshot per user prompt. |
| `max` | integer | `20` | `0`–`1000` | Snapshots kept per root before the oldest are pruned. |
| `includeUntracked` | boolean | `true` | | Include untracked, non-ignored files in a snapshot. |
| `safetySnapshot` | boolean | `true` | | Snapshot the current state before a restore, so a rewind can itself be undone. |
| `autoPrune` | boolean | `true` | | Prune refs beyond `max` after each save. |
| `showStatus` | boolean | `true` | | Show the `↺ N` chip. |
| `watch` | string[] | `[]` | | Extra tool names treated as mutating, so a call triggers a snapshot. |
| `ignore` | string[] | `[]` | | Tool names never to snapshot; the extension's own tools are always excluded. |
| `refNamespace` | string | `"refs/pi/rewind"` | | Git ref namespace for stored snapshots; trailing slashes are stripped. |

## `todo` — the todo widget

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `hideWhenComplete` | boolean | `true` | | Hide the one-line widget once every item is completed; an empty list always hides. |

## `web-access` — search and fetch

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `search.provider` | string | `"auto"` | `auto`, `duckduckgo`, `searxng`, `brave` | `auto` picks the first configured backend; a named id forces it, even when it is not configured. |
| `search.endpoint` | string | `""` | `""` or an `http(s)://` URL | SearXNG base URL; empty means SearXNG cannot run. |
| `search.language` | string | `"auto"` | `auto` or a language code | SearXNG language; `auto` picks `zh-CN` for CJK input and `en` otherwise. |
| `search.safeSearch` | integer | `0` | `0`–`2` | SearXNG safesearch level: 0 off, 1 moderate, 2 strict. |
| `search.categories` | string | `"general"` | | SearXNG `categories` parameter. |
| `search.apiKeyEnv` | string | `""` | | Environment variable holding an API key; preferred over `apiKey`. |
| `search.apiKey` | string | `""` | | Literal API key fallback for keyed backends and auth proxies. |
| `search.maxResults` | integer | `8` | `1`–`20` | Default number of results. |
| `search.timeoutMs` | integer | `15000` | `1000`–`120000` | Per-request timeout in milliseconds. |
| `search.maxBytes` | integer | `5000000` | `1024`–`50000000` | Maximum response size in bytes. |
| `search.minIntervalMs` | integer | `500` | `0`–`60000` | Minimum spacing between requests. |
| `search.maxOutputChars` | integer | `12000` | `1000`–`100000` | Character budget for the model-facing text. |
| `search.userAgent` | string | `"my-pi-agent/0.1 (+https://github.com/gavin-hu/my-pi-agent)"` | | User-Agent sent with search requests. |
| `fetch.timeoutMs` | integer | `20000` | `1000`–`120000` | Per-request timeout in milliseconds. |
| `fetch.maxBytes` | integer | `5000000` | `1024`–`50000000` | Maximum response size in bytes. |
| `fetch.maxOutputChars` | integer | `20000` | `500`–`100000` | Default and ceiling for the returned text slice. |
| `fetch.userAgent` | string | `"my-pi-agent/0.1 (+https://github.com/gavin-hu/my-pi-agent)"` | | User-Agent sent with fetch requests. |
| `fetch.acceptLanguage` | string | `"zh-CN,zh;q=0.9,en;q=0.8"` | | `Accept-Language` header. |
| `fetch.allowPrivateHosts` | boolean | `false` | | Allow loopback, private, and internal targets, disabling the SSRF guard. |
| `fetch.maxRedirects` | integer | `5` | `0`–`10` | Redirect hops to follow, each one re-validated. |
| `fetch.maxBodyChars` | integer | `100000` | `1000`–`1000000` | Maximum request body length in characters. |
| `fetch.pdfEnabled` | boolean | `true` | | Extract text from PDF responses with the optional `unpdf` package. |
| `fetch.cacheEnabled` | boolean | `true` | | Cache extracted pages for the registration. |
| `fetch.cacheTtlMs` | integer | `300000` | `0`–`3600000` | Cache entry lifetime; `0` never expires. |
| `fetch.cacheMaxEntries` | integer | `8` | `1`–`50` | Maximum cached pages. |
| `fetch.cacheMaxBytes` | integer | `8000000` | `1024`–`50000000` | Maximum total cached text bytes. |

## `wechat` — the WeChat bridge

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `allowedPeers` | string[] | `[]` | | Extra peers allowed to drive the agent, by id or label; the owner is always allowed. |
| `peers` | object | `{}` | | Per-peer overrides, keyed by peer id or label. |
| `maxTurnsPerHour` | integer | `0` | `0`–`500` | Turns allowed per peer in a rolling hour; `0` disables the cap. |
| `maxReplyChars` | integer | `4000` | `1`–`20000` | Replies longer than this are split into several messages. |
| `botAgent` | string | `"pi-wechat"` | Up to 256 characters | Identifier sent as `base_info.bot_agent`. |
| `channelVersion` | string | `"0.1.0"` | | Plugin version sent as `base_info.channel_version`. |
| `cdnBaseUrl` | string | `"https://novac2c.cdn.weixin.qq.com/c2c"` | | Base URL for CDN media downloads and uploads; trailing slashes are stripped. |
| `maxMediaBytes` | integer | `20971520` | `1024`–`104857600` | Inbound media larger than this is skipped. |
| `maxInboundChars` | integer | `8000` | `1000`–`100000` | Inbound text longer than this is truncated before it reaches the model. |
| `typingIndicator` | boolean | `true` | | Send a typing indicator while an inbound turn is generated. |
| `remotePrompts` | boolean | `true` | | Route interactive dialogs raised during a WeChat turn back to WeChat. |
| `pollHoldMs` | integer | | `1000`–`120000`; below `1000` clears the setting | Long-poll hold to request from the server, in milliseconds. |

`peers` is keyed by peer id or label (both forms match, e.g. `alice` and
`alice@im.wechat`). Each value is an object shaped `{ "tools"?: string[] }`,
where `tools` lists that peer's active tool names: absent keeps the full set, an
empty list disables tools, and the list is capped at 200 entries.

## `worktree` — isolated worktrees

`worktree` reads the project document from the repository root rather than the
active working directory.

| Key | Type | Default | Values | What it does |
|---|---|---|---|---|
| `dir` | string | `".pi/worktrees"` | | Directory under the repository root that holds managed worktrees. |
| `baseRef` | string | `"fresh"` | `fresh`, `head` | Branch a new worktree starts from: `fresh` fetches the remote default branch, `head` uses local HEAD. |
| `branchPrefix` | string | `"worktree-"` | | Prefix of the branch a managed worktree creates. |
| `fetchRemote` | boolean | `true` | | Fetch the remote before branching from the default branch. |
| `fetchTimeoutMs` | integer | `5000` | `0`–`600000` | Timeout for that fetch, in milliseconds. |
| `onExit` | string | `"ask"` | `ask`, `keep`, `remove` | What `exit_worktree` does by default: ask, always keep, or always remove. |
| `pruneAfterDays` | integer | `7` | `0`–`3650` | Age in days after which `/worktree prune` may remove a clean, unused worktree. |
| `include` | string[] | `[]` | | Gitignored files copied into a new worktree; the fallback when `.worktreeinclude` is absent. |
| `skipOverrides` | string[] | `[]` | | Built-in tool names not to re-register, so another extension can own them. |
| `guard.blockFileEscapes` | boolean | `true` | | Block `write`/`edit` whose resolved path leaves the active worktree. |
| `guard.blockReadEscapes` | boolean | `false` | | Also block read-only tools (`read`, `grep`, `find`, `ls`) from leaving it. |
| `guard.blockGitRedirects` | boolean | `true` | | Block git commands aimed at the main checkout. |
| `guard.blockSymlinkEscapes` | boolean | `true` | | Block writes whose real path leaves the worktree through a symlink. |
| `guard.blockUnparsableCommands` | boolean | `false` | | Block shell commands whose git behaviour cannot be verified. |
