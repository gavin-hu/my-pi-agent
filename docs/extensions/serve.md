# serve — the session's one loopback server

## Capabilities

| Capability | How | What you get |
|---|---|---|
| One port for every page of a session | automatic: the first page that opens binds it | the file browser at `/`, the board at `/board/`, and a review at `/plan/<id>/` answer on one origin, so a bookmark, a firewall rule, and a port to remember are one thing |
| One chip for that port | `◉ <port>` in the status bar | the session's port while anything is served on it, and nothing when no page is open |
| A port that survives a restart | `serve.port` in `bytefly.json` | the same address after `/resume`, so a saved URL still opens the page it names |
| A second session on its own port | automatic: servers are keyed by Pi session | a WeChat peer conversation never answers on this session's port |
| One page reachable on the LAN, on request | the asking page calls `mount.share()` | a teammate's link names exactly one address, and only that page answers there |

## Quickstart

There is nothing to run: `serve` is infrastructure, and the pages that use it are
`/board`, `/browse`, and `/plan review`.

```bash
/board          # http://127.0.0.1:4780/board/?token=…
/browse         # http://127.0.0.1:4780/
/plan review    # http://127.0.0.1:4780/plan/3f9c21aa/?token=…
```

All three answer on `:4780`; the footer shows `◉ 4780` while any of them is open
and drops the chip when the last one closes.

## Routes

The server holds prefixes, not pages. Each one is claimed by the extension that
serves it, and a request reaches that extension with its prefix stripped:

| Prefix | Served by | Note |
|---|---|---|
| `/` | `file-browse` | the file browser, which holds the origin's root because every URL it emits is root-absolute — its own script, its links, and the destinations it rewrites out of Markdown; `/browse/<path>` is one directory |
| `/board/` | `board` | the read-only board page, with its token in the query |
| `/plan/<id>/` | `plan` | one review; the id is the review's, so two reviews never share a namespace |

Anything else is a `404` with a plain-text body, and a prefix named without its
trailing slash (`/board`) is redirected to the slashed form, because a page's own
links are relative to its directory. A prefix another page already holds is
refused by name rather than served twice.

## Behaviour by mode

The server runs in every mode, but the chip needs a UI: RPC and JSON sessions serve
their pages and skip it. Nothing here reads or writes the transcript.

## Configuration

The `serve` section of the shared `bytefly.json` (global, then project, project wins:

| Key | Default | What it does |
|---|---|---|
| `port` | `0` | `0` takes one free port in `4780`–`5779` for the session and remembers it; a positive value pins the session's server so a bookmarked address survives a restart |

The pin belongs to the first session in a process that binds: a second session — a
WeChat peer conversation loads every extension except the bridge itself — takes an
OS-chosen port instead of failing on a port the host already holds. A second
*process* that finds the pinned port taken is told so rather than moved silently off
the address a bookmark names.

## Security

The server binds `127.0.0.1`. The unit of exposure is the mount: a prefix answers
only what its page routes, and each page keeps its own `Host` allowlist, its own
token, and its own method list in `lib/http`.

A shared review is the one exception, and it is the reviewing page's own: it asks
for a listener on a single LAN address, and that listener carries that one prefix.
`file-browse` and `board` are never reachable that way, and a page that stops
sharing closes its LAN listener at once.

## Limitations

- A page needs `serve` loaded. Without it every page refuses with a sentence naming
  the extension, instead of binding a rival socket.
- One pin is one port for the whole session: two repositories running pages on this
  machine at once need a project-level `serve.port` each, or neither pinned.
- The port moves to an OS-chosen one when the pinned port is taken, so an old
  bookmark keeps failing until the setting or the other process is dealt with.

## Non-goals

- It serves no page of its own, and registers no tool and no command.
- It is not a general web server: loopback, a page's own routes, one optional LAN
  address per shared page, and nothing else.
- It does not proxy or rewrite; a page's paths are its own, under its prefix.

## Pi integration

- Registers `pi.events.on(HTTP_MOUNT_CHANNEL, …)` in the factory — registration only.
  Binding happens on the first mount, never at load and never on `session_start`.
- `session_start` records the session's working directory and its context, so the
  pin is read from that session's config and the chip is drawn in its UI.
- `session_shutdown` closes the session's socket, its LAN listener, and its chip.
  It is idempotent.

## Design notes

A session has one port, so the socket cannot belong to a page. The page asks for a
prefix over `pi.events` — the mechanism the repository already uses for a
cross-extension request that must be answered — and `lib/http` owns the socket, the
dispatch, the body cap per mount, and the idle grace per mount.

The handshake is *claimed*, not awaited: `server.listen` cannot answer synchronously,
so the owner responds with the pending bind and only a request nobody claimed is
refused. Without that distinction a bind that is still starting looks exactly like a
session with no server.

## Files

| Path | Responsibility |
|---|---|
| [`../../extensions/serve/index.ts`](../../extensions/serve/index.ts) | The Pi wiring: the bus listener, the per-session directory and context, the port chip, and the shutdown |
| [`../../extensions/serve/registry.ts`](../../extensions/serve/registry.ts) | The session's servers: binding on first mount, the pin's owner, the remembered port, prefix refusals, the LAN listener a shared page borrows, and closing with the last mount |
| [`../../extensions/serve/config.ts`](../../extensions/serve/config.ts) | The `serve` section: `port`, its clamp, and the two documents it resolves over |

## Testing

`config.test.ts`, `registry.test.ts`, and `extension.test.ts`, declared under
`serve` in `test/suite-manifest.ts`.

The registry cases bind real sockets on `127.0.0.1`: one port for two pages of a
session, a second session on its own port, a refused duplicate prefix, the socket
closing with its last page and reopening where it was, the pin belonging to the
first session that binds, and a LAN share reaching one page only. The extension
cases drive the shipped bus path through `requestMount`, including the chip and the
shutdown.
