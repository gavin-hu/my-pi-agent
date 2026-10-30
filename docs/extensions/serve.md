# serve — the session's one loopback server

## Capabilities

| Capability | How | What you get |
|---|---|---|
| One port for every page of a session | automatic: the first page that opens binds it | the file browser at `/files/`, the board at `/board/`, and a review at `/plan/<id>/` answer on one origin, so a bookmark, a firewall rule, and a port to remember are one thing |
| One chip for that port | `◉ <port>` in the status bar | the session's port while anything is served on it, and nothing when no page is open |
| A port that survives a restart | automatic: the project's own port | a session that starts again lands where a bookmark already points, so a saved URL still opens the page it names; `serve.port` overrides it |
| Two projects on one machine | automatic: the port is the repository's, hashed into the band | neither needs a setting to avoid the other, and a worktree of one repository keeps the number the main checkout uses |
| A second session on its own port | automatic: servers are keyed by Pi session | a WeChat peer conversation never answers on this session's port |
| One page reachable on the LAN, on request | the asking page calls `mount.share()` | a teammate's link names exactly one address, and only that page answers there |

## Quickstart

There is nothing to run: `serve` is infrastructure, and the pages that use it are
`/board`, `/browse`, and `/plan review`.

```bash
/board          # http://127.0.0.1:<port>/board/?token=…
/browse         # http://127.0.0.1:<port>/files/
/plan review    # http://127.0.0.1:<port>/plan/3f9c21aa/?token=…
```

All three answer on that one port — the project's own, in `4780`–`5779` — and the
footer shows `◉ <port>` while any of them is open, dropping the chip when the last
one closes.

## Routes

The server holds prefixes, not pages. Each one is claimed by the extension that
serves it, and a request reaches that extension with its prefix stripped:

| Prefix | Served by | Note |
|---|---|---|
| `/files/` | `file-browse` | the file browser: its tree, its file pages, its own script, and the links it rewrites out of Markdown, all built from this prefix; `/files/browse/<path>` is one directory |
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
| `port` | `0` | `0` takes the project's own port — its repository key hashed into `4780`–`5779` — and falls back to an OS-chosen one when that port is taken; a positive value pins the session's server so a bookmarked address survives a restart, and a taken pin is reported by name instead of moved |

The default is the repository's, so two repositories take two numbers without a
setting and a restart lands where the bookmark was. A second session of one
repository — a WeChat peer, or another checkout — prefers the same number and takes
an OS-chosen port when the first one holds it.

The pin belongs to the first session in a process that binds: a second session takes
an OS-chosen port instead of failing on a port the host already holds. A second
*process* that finds the pinned port taken is told so rather than moved silently off
the address a bookmark names.

## Security

The server binds `127.0.0.1`. The unit of exposure is the mount: a prefix answers
only what its page routes, and each page keeps its own `Host` allowlist, its own
token, and its own method list in `lib/http`.

A shared review is the one exception, and it is the reviewing page's own: it asks
for a listener on a single LAN address, and that listener carries only the prefixes
that asked for it. `file-browse` and `board` are never reachable that way, and a page
that stops sharing leaves the listener at once — the socket closes with the last page
that was still sharing it.

## Limitations

- A page needs `serve` loaded. Without it every page refuses with a sentence naming
  the extension, instead of binding a rival socket.
- Two projects can hash into the same port, and the second start takes an OS-chosen one
  instead: its bookmark moves until that project sets `serve.port`.
- Two checkouts of one repository at once prefer one number, so the second takes an
  OS-chosen port each session and only the first keeps the address a bookmark names.
- The default is a guess: a port another process holds moves the session to an
  OS-chosen one without a word — the chip shows the number — while a pinned port that is
  taken is refused by name.

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

The default is the repository key hashed into the band rather than a fresh draw. The
key is the one identity this repository already has — `session-bus` files sessions by
it, `plan` files plans by it — and every worktree of a repository resolves the same
one, so a bookmark saved in the main checkout opens the worktree's page. A draw was
the reason a bookmark only worked until the next start.

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
closing with its last page and reopening where it was, the project's port taken by the
first bind and the OS-chosen fallback when another listener holds it, the pin belonging
to the first session that binds, and a LAN share reaching one page only. The extension
cases drive the shipped bus path through `requestMount`, including the project's port
surviving a restart, the chip, and the shutdown.
