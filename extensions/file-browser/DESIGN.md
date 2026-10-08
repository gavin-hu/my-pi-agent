# `file-browser` — Design

Status: **implemented** (see [`README.md`](./README.md)).

## Goal

Give a Pi session a one-command way to look at its working directory in a real
browser: `/serve` starts a read-only HTTP server and opens it. The UI is a
two-pane tree browser — a collapsible path tree, directory listings, and file
pages — with image thumbnails, per-language icons, and a client-side filter. No
dependencies beyond `node:http` and one first-party script.

## Non-goals

- No editing or writing from the browser.
- No syntax highlighting, markdown rendering, or third-party assets.
- No auth, no LAN exposure: loopback only.
- Not a general static-file server: the root is confined to the effective cwd.

## Lifecycle

1. The factory registers `/serve` and a `session_shutdown` handler and opens no
   socket (Pi forbids sockets/timers in the factory).
2. `/serve` resolves `resolveEffectiveCwd(ctx.cwd)`, loads config, parses args,
   and `await createFileServer(...)`: `realpath` the root, bind `127.0.0.1`,
   await `listening`, return `{ url, port, root, close }`. The handle lives in a
   closure; the URL is notified and the browser opened (unless `autoOpen:false`).
3. Requests are handled by `handleRequest`, which returns a `ServeResponse`; the
   server streams `filePath` responses and suppresses bodies for `HEAD`.
4. `/serve stop` and `session_shutdown` await the idempotent `close()`.

## Routing and model

`handleRequest(context, method, rawUrl, headers)`:

1. Only `GET`/`HEAD` (else `405`), and a `Host` allowlist (else `403`).
2. `new URL` for the pathname and query (malformed → `400`).
3. Route match → `browse`, `view`, `raw`, `treeApi`, `/app.js`, `/favicon.ico`.
4. Every path goes through `paths.ts`; reads are capped by config.

The response is a plain object, so the routing logic is tested without a socket;
`server.test.ts` is the only test that binds a port.

## Safety

- **Path guard** (`paths.ts`): decode once, reject NUL and absolute paths,
  `resolve` under the root, then `realpath` the target (or nearest existing
  ancestor) and require containment. This blocks `../`, encoded traversal, and
  symlink escapes. Listings use `lstat` and mark symlinks; a symlink is only
  followed when its real path stays inside the root.
- **Host allowlist**: `127.0.0.1[:port]`, `localhost[:port]`, `[::1][:port]`.
- **CSP**: pages allow only same-origin scripts and inline styles; `/raw` uses
  `default-src 'none'; script-src 'none'; sandbox` and `nosniff`, so a served
  SVG/HTML file cannot execute. No CORS headers.
- **Caps**: `maxFileBytes` (inline rendering), `maxTextLines` (rendered lines),
  `maxThumbBytes` (thumbnails), `maxDirEntries` (listings).

## UI

Server-rendered two-pane HTML with an inline style block and inline SVG icons.
`client.ts` progressively enhances: the filter hides non-matching tree/listing
rows while keeping ancestors, disclosure triangles lazily `fetch("/api/tree")`
for unrendered folders, and broken thumbnails fall back to the category icon.
Without JS, the tree shows the current path's ancestors and all navigation is
ordinary links. The palette follows `nocturne-dark`/`nocturne-light` via
`prefers-color-scheme`.

## Files

| File | Purpose |
|---|---|
| `index.ts` | Command, closure state, browser open, shutdown cleanup |
| `config.ts` | `ServeConfig`, defaults, validation, merge |
| `paths.ts` | `HttpError`, decode, resolve, containment |
| `files.ts` | `classifyByName`, `isProbablyText`, `listDirectory`, `readFileView`, `buildTree` |
| `icons.ts` | `SPRITE`, `languageOf`, `FOLDER_ICON`, `LINK_ICON` |
| `client.ts` | `CLIENT_JS` |
| `html.ts` | Page renderers, escaping, `encodePath`, inline CSS |
| `router.ts` | `handleRequest` and route/response types |
| `server.ts` | `createFileServer` over `node:http` |
| `open.ts` | `browserCommand`, `openInBrowser` |

## Testing

`test/file-browser/` covers the path guard (traversal, encoded, NUL, malformed,
absolute, symlink escape and in-root symlink), file classification/listings/
reads/tree, the icon mapping and sprite, HTML escaping/encoding/rendering, the
client script and its serving, the platform browser commands with an injected
spawn, the router (routes, `/api/tree`, status codes, `Host`, `HEAD`, `/raw`
headers) without a socket, a real `127.0.0.1:0` server, and the command
lifecycle with injected seams.

## Risks

- A malicious local page could probe the port; the `Host` allowlist and the
  absence of CORS headers mitigate reads, and the server is read-only.
- Serving the root exposes whatever is on disk to the local user who started it;
  this is intentional and scoped to loopback. Files are never written.
