# `serve` — view the working directory in a browser

`/serve` starts a **read-only** HTTP server rooted at the effective working
directory, opens the default browser at it, and prints the URL. The page is a
two-pane file browser: a collapsible path tree on the left, directory listings
and file views on the right, with image thumbnails and per-language icons. It is
bound to `127.0.0.1` and ships no dependencies — `node:http` plus one small
vanilla script.

## Commands

```
/serve            start at the working directory, open the browser, print the URL
/serve <path>     start with a subdirectory of the working directory as the root
/serve status     print the root and URL, or "not running"
/serve stop       stop the server
```

- The root is the effective cwd, so an active `worktree` session serves the
  worktree. `<path>` must resolve inside it.
- Starting while already running reprints the URL and re-opens the browser;
  `/serve <path>` restarts with the new root.
- The server is closed on `session_shutdown`.

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

`~/.pi/agent/serve.json` merged with `<cwd>/.pi/serve.json` (project wins):

```jsonc
{
  "port": 0,                 // 0 = OS-assigned
  "autoOpen": true,          // open the browser on start; false for headless
  "maxFileBytes": 1048576,   // larger files show a download card only
  "maxThumbBytes": 5242880,  // larger images get an icon, not a thumbnail
  "maxTextLines": 5000,      // rendered lines before truncation
  "maxDirEntries": 2000,     // listed entries before truncation
  "treeDepth": 4,            // sidebar levels expanded below the root
  "thumbnails": true
}
```

## Security

- Binds `127.0.0.1` only; no auth and no LAN exposure.
- Only `GET`/`HEAD` are served. A `Host` header that is not `127.0.0.1` or
  `localhost` is rejected (DNS-rebinding defense), and no CORS headers are sent.
- Every path is decoded once, resolved under the root, and `realpath`-checked, so
  `../`, encoded traversal, and symlink escapes are refused. Symlinks are listed
  but only followed inside the root.
- Pages use a strict CSP with no third-party scripts; `/raw` uses
  `script-src 'none'; sandbox` so a served SVG/HTML file cannot execute.
- Read-only: nothing is ever written.

## Files

| File | Purpose |
|---|---|
| `index.ts` | `/serve` command, running-server closure, shutdown cleanup |
| `config.ts` | Config defaults, validation, global/project merge |
| `paths.ts` | Decode, resolve, and `realpath`-containment guard |
| `files.ts` | Classification, listings, text reads, sidebar tree |
| `icons.ts` | Inline SVG sprite and the per-language mapping |
| `client.ts` | The `/app.js` source (tree toggle, filter, thumbnail fallback) |
| `html.ts` | Page renderers and the inline CSS |
| `router.ts` | Pure request handler |
| `server.ts` | `node:http` server |
| `open.ts` | Cross-platform browser opener |

See [`DESIGN.md`](./DESIGN.md) for the design and testing notes.
