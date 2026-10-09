# file-browser — view the working directory in a browser

`/serve` starts a **read-only** HTTP server rooted at the effective working
directory, opens the default browser at it, and prints the URL. The page is a
two-pane file browser: a collapsible path tree on the left, directory listings
and file views on the right, with image thumbnails and per-language icons. It is
bound to `127.0.0.1` and ships no dependencies — `node:http` plus one small
vanilla script.

```bash
pi --extension ./extensions/file-browser   # load just this extension
pi -e .                                    # load the whole @gavin-hu/my-pi-agent package
```

## What it does

- **One-command browsing.** `/serve` starts the server, prints the URL, and
  opens the browser (unless `autoOpen: false`).
- **Two-pane UI.** A server-rendered tree, directory listings, and file pages,
  progressively enhanced by one first-party script (filter, lazy tree
  expansion, thumbnail fallback).
- **Rich previews.** Text, images (thumbnails), and binary/over-size download
  cards, with per-language icons.
- **Read-only and loopback-scoped.** No editing, no writing, no LAN exposure.
- **Git context.** A read-only header chip shows the checked-out branch (or
  detached head) and a dirty marker, and reflows on narrow screens.
- **No dependencies.** `node:http` plus the inline sprite, CSS, and client
  script.

## Commands

```bash
/serve            start at the working directory, open the browser, print the URL
/serve <path>     start with a subdirectory of the working directory as the root
/serve status     print the root and URL, or "not running"
/serve stop       stop the server
```

- The root is the effective cwd, so an active `worktree` session serves the
  worktree. `<path>` must resolve inside it.
- The port is fixed for the session: the first `/serve` picks a random port
  in `4780`–`5779` and every later `/serve` in that session reuses it, so the
  URL stays stable across roots and restarts. Set `"port"` to pin an explicit
  port; a busy port is reported, not silently changed.
- Starting while already running with the same root reprints the URL without
  restarting; a different root (or a changed pinned port) restarts the server.
- The server is closed on `session_shutdown`.

### Status

While a server is running, the extension publishes a two-tone `⊙ <port>` chip
(a green circle-dot and a blue port) under the shared `serve` status key. The
[`status-bar`](../status-bar/) extension routes it to line 1's right zone
beside `⎇ branch` and `⑂ worktree`; it
is cleared on stop and on `session_shutdown`. The chip is session-local: it
reflects only this session's server, with no cross-session sharing.

## Routes

| Route | Result |
|---|---|
| `/`, `/browse[/<rel>]` | tree + directory listing |
| `/view/<rel>` | tree + file page (text, image, binary, or over-size) |
| `/raw/<rel>` | raw bytes, streamed; downloads and image sources |
| `/api/tree?path=<rel>` | JSON children for lazy tree expansion |
| `/app.js` | the first-party client script |
| `/favicon.ico` | `204` (the icon is a data URI) |

## Configuration

`~/.pi/agent/file-browser.json` merged with `<cwd>/.pi/file-browser.json`
(project wins):

```jsonc
{
  "port": 0,                 // 0 = one random port fixed for the session
  "autoOpen": true,          // open the browser on start; false for headless
  "maxFileBytes": 1048576,   // larger files show a download card only
  "maxThumbBytes": 5242880,  // larger images get an icon, not a thumbnail
  "maxTextLines": 5000,      // rendered lines before truncation
  "maxDirEntries": 2000,     // listed entries before truncation
  "thumbnails": true
}
```

## Security

- **Loopback only.** Binds `127.0.0.1`; no auth and no LAN exposure.
- **Method and Host.** Only `GET`/`HEAD` are served (else `405`); a `Host`
  header that is not `127.0.0.1[:port]`, `localhost[:port]`, or `[::1][:port]`
  is rejected (else `403`, DNS-rebinding defense), and no CORS headers are sent.
- **Path guard.** Every path is decoded once, NUL and absolute paths are
  rejected, the path is resolved under the root, and the target (or nearest
  existing ancestor) is `realpath`-checked for containment. This blocks `../`,
  encoded traversal, and symlink escapes. Symlinks are listed but only followed
  when their real path stays inside the root.
- **CSP.** Pages allow only same-origin scripts and inline styles; `/raw` uses
  `default-src 'none'; script-src 'none'; sandbox` plus `nosniff`, so a served
  SVG/HTML file cannot execute.
- **Caps.** `maxFileBytes` (inline rendering), `maxTextLines` (rendered lines),
  `maxThumbBytes` (thumbnails), and `maxDirEntries` (listings) bound every read.
- **Git reads.** The header chip runs read-only git (`rev-parse`, `status
  --porcelain`) with a timeout and a short cache; any failure simply omits it.
- **Read-only.** Nothing is ever written.

## Limitations

- `/serve` has no auth; a malicious local page could probe the port. The `Host`
  allowlist and the absence of CORS headers mitigate reads, and the server is
  read-only.
- Serving the root exposes whatever is on disk to the local user who started it;
  this is intentional and scoped to loopback.

## Non-goals

- No editing or writing from the browser.
- No syntax highlighting, markdown rendering, or third-party assets.
- No auth and no LAN exposure: loopback only.
- Not a general static-file server: the root is confined to the effective cwd.

## Pi integration

| Integration point | How |
|---|---|
| Command | `/serve` registers a single command from the factory; no tools are exposed. |
| State | The running server, its root, and the session port live in a module-local closure; nothing is persisted and no session entries are written. |
| Lifecycle | The factory opens no socket; the server is created on `/serve` and closed idempotently by `/serve stop` and `session_shutdown`. |

## Design notes

- **Lifecycle.** `/serve` resolves `resolveEffectiveCwd(ctx.cwd)`, loads config,
  selects the port, parses args, and `await createFileServer(...)`: `realpath`
  the root, bind `127.0.0.1`, await `listening`, return `{ url, port, root,
  close }`. The port is chosen once for the session: a pinned config `port`
  wins, otherwise a random port is drawn and cached after the first successful
  bind, so later starts reuse it (a conflict is reported and the next `/serve`
  rolls another). `/serve stop` and `session_shutdown` await the idempotent
  `close()`; `session_shutdown` also clears the cached port.
- **Pure routing.** `handleRequest(context, method, rawUrl, headers)` validates
  method and `Host`, parses the URL, matches a route, and runs every path
  through `paths.ts`. It returns a plain `ServeResponse`, so routing is tested
  without a socket; `server.ts` is the only part that binds a port.
- **Progressive UI.** The page is server-rendered HTML with an inline style
  block and inline SVG icons. `client.ts` enhances it: the filter hides
  non-matching rows while keeping ancestors, disclosure triangles lazily
  `fetch("/api/tree")`, and broken thumbnails fall back to the category icon.
  Without JS, the tree shows the current path's ancestors and navigation is
  ordinary links. The palette follows `nocturne-dark`/`nocturne-light` via
  `prefers-color-scheme`.
- **Streaming responses.** The server streams `filePath` responses and
  suppresses bodies for `HEAD`, so large `/raw` files are not buffered.
- **Root confinement over feature breadth.** The root is deliberately confined
  to the effective cwd rather than serving an arbitrary directory, so a
  worktree session serves the worktree and nothing above it.

## Files

| File | Purpose |
|---|---|
| `index.ts` | `/serve` command, running-server closure, shutdown cleanup |
| `config.ts` | Config defaults, validation, global/project merge |
| `paths.ts` | Decode, resolve, and `realpath`-containment guard |
| `files.ts` | Classification, listings, text reads, sidebar tree |
| `git.ts` | Read-only branch/dirty provider for the header chip |
| `icons.ts` | Inline SVG sprite and the per-language mapping |
| `client.ts` | The `/app.js` source (tree toggle, filter, thumbnail fallback) |
| `html.ts` | Page renderers and the inline CSS |
| `router.ts` | Pure request handler |
| `server.ts` | `node:http` server |
| `open.ts` | Cross-platform browser opener |

## Testing

`extensions/file-browser/` covers the path guard (traversal, encoded, NUL, malformed,
absolute, symlink escape and in-root symlink), file classification/listings/
reads/tree, the icon mapping and sprite, HTML escaping/encoding/rendering, the
client script and its serving, the platform browser commands with an injected
spawn, the router (routes, `/api/tree`, status codes, `Host`, `HEAD`, `/raw`
headers) without a socket, a real `127.0.0.1:0` server, the session-port
lifecycle (fixed on first start, reused, and re-rolled after a conflict), the
git status provider (branch, dirty, detached, non-repo, failure, and TTL
cache), and the command lifecycle with injected seams.
