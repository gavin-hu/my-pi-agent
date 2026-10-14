# file-browser — view the working directory in a browser

`/serve` starts a **read-only** HTTP server rooted at the effective working
directory, opens the default browser at it, and prints the URL. The page is a
two-pane file browser: a collapsible path tree on the left, directory listings
and file views on the right, with image thumbnails, rendered Markdown,
highlighted code, per-language icons, and a fuzzy quick-open palette. It is
bound to `127.0.0.1`
and ships no dependencies — `node:http` plus one small vanilla script.

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
- **Rich previews.** Text, rendered Markdown, images (thumbnails), and
  binary/over-size download cards, with per-language icons.
- **First-party syntax highlighting.** Code files render with keywords,
  strings, numbers, and comments colored, in the dark and light palettes:
  JavaScript/TypeScript (`js`, `mjs`, `cjs`, `jsx`, `ts`, `mts`, `cts`, `tsx`),
  JSON, CSS (`css`, `scss`, `sass`, `less`), HTML/XML and template components
  (`html`, `htm`, `xml`, `vue`, `svelte`), shell (`sh`, `bash`, `zsh`),
  Python (`py`, `pyw`, `pyi`), Java, YAML (`yaml`, `yml`), and SQL. Other text
  types stay plain.
- **Rendered Markdown.** `.md`/`.markdown` files render as headings, lists,
  tables, code, links, and images, with a one-click **raw** view (`?raw=1`).
  Fenced code blocks are syntax-highlighted when the fence names a supported
  language. Raw HTML in the source is escaped, never executed, and external
  images are shown as links rather than fetched.
- **Sortable listings.** The Name / Size / Modified headers sort the current
  directory, directories first, and the choice is remembered per browser.
- **Copy and wrap.** Copy a file's root-relative path or its contents, and
  toggle line wrapping for text and raw views.
- **Theme toggle.** A header button switches between the dark and light
  palettes and remembers the choice per browser; until it is used, the palette
  follows the system `prefers-color-scheme`.
- **Quick open.** `/` (or `Ctrl/Cmd+K`, or the sidebar button) opens a fuzzy
  path finder over a capped index of the tree, with keyboard navigation and a
  highlighted match; Enter opens the file.
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

While a server is running, the extension publishes a two-tone `◉ <port>` chip
(a green circle-dot and a blue port) under the shared `serve` status key. The
[`bytefly`](../bytefly/) extension routes it to line 1's right zone
beside `⎇ branch` and `⑂ worktree`; it
is cleared on stop and on `session_shutdown`. The chip is session-local: it
reflects only this session's server, with no cross-session sharing.

## Routes

| Route | Result |
|---|---|
| `/`, `/browse[/<rel>]` | tree + directory listing |
| `/view/<rel>` | tree + file page (text, Markdown, image, binary, or over-size) |
| `/view/<rel>?raw=1` | raw Markdown/text source instead of the rendered view |
| `/raw/<rel>` | raw bytes, streamed; downloads and image sources |
| `/api/tree?path=<rel>` | JSON children for lazy tree expansion |
| `/api/files?q=<query>` | JSON fuzzy path matches for the quick-open palette |
| `/app.js` | the first-party client script |
| `/theme.js` | the pre-paint theme bootstrap |
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
  "thumbnails": true,
  "markdown": true,          // render Markdown files as formatted HTML
  "maxIndexEntries": 20000   // files collected for quick open before truncation
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
- **Markdown safety.** Rendered Markdown is escape-first: raw HTML is shown as
  text, link schemes are allowlisted (`javascript:`/`data:` dropped), and an
  external image is rendered as a link, never loaded. The page CSP keeps the
  rest inert.
- **Highlighting safety.** The highlighter escapes every literal before it
  wraps it in a token span, so a code file's content cannot inject markup or
  attributes; only the fixed `tok-*` class names reach the page.
- **Caps.** `maxFileBytes` (inline rendering), `maxTextLines` (rendered lines),
  `maxThumbBytes` (thumbnails), and `maxDirEntries` (listings) bound every read.
- **Git reads.** The header chip runs read-only git (`rev-parse`, `status
  --porcelain`) with a timeout and a short cache; any failure simply omits it.
- **Read-only.** Nothing is ever written.

## Limitations

- Syntax highlighting covers the built-in language set below; any other text
  type renders exactly as before. State that the tokenizer does not carry
  across lines (shell heredocs, interpolation inside a template literal) is
  approximated rather than parsed.
- `/serve` has no auth; a malicious local page could probe the port. The `Host`
  allowlist and the absence of CORS headers mitigate reads, and the server is
  read-only.
- Serving the root exposes whatever is on disk to the local user who started it;
  this is intentional and scoped to loopback.

## Non-goals

- No editing or writing from the browser.
- No third-party assets: the Markdown renderer and the syntax highlighter are
  first-party, and raw HTML in a Markdown file is escaped, not executed.
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
  `fetch("/api/tree")`, broken thumbnails fall back to the category icon, the
  listing headers sort in place, the wrap toggle is remembered, and the copy
  buttons use the clipboard. Without JS the page still browses and renders
  Markdown, and the JS-only controls (filter, disclosure, actions, quick open)
  are hidden; the sort buttons lose their pointer so they do not look live. The
  palette is a self-contained, GitHub-inspired light/dark set whose canvas and
  accent match the `bytefly-dark`/`bytefly-light` themes; it follows
  `prefers-color-scheme` until an explicit choice sets `data-theme` on the root:
  `/theme.js` applies the saved choice in the head before first paint, and the
  header toggle flips and stores it (`serve-theme` in `localStorage`).
- **Markdown rendering.** `markdown.ts` is a first-party, escape-first renderer
  for the constructs that show up in repository READMEs. It emits only a known
  tag set, escapes every literal character, allowlists URL schemes (dropping
  `javascript:`/`data:`), rewrites local links and images to `/view`/`/raw`, and
  renders an external image as a link instead of loading it (the page CSP is
  `img-src 'self' data:`). The Rendered/Raw switch is a server-side `?raw=1`
  link, so it works without JavaScript. Set `markdown: false` to fall back to
  the plain-text view. A fenced code block whose info string names a supported
  language is highlighted through `highlight.ts` (either an extension or a
  long-form alias, `fenceLanguage`); an absent or unknown language stays plain.
- **Syntax highlighting.** `highlight.ts` is a first-party, escape-first
  tokenizer for the file types that dominate a repository: JavaScript and
  TypeScript, JSON, CSS (incl. SCSS/Sass/Less), HTML/XML and template
  components, shell, Python, Java, YAML, and SQL. `detectLanguage` maps a
  filename to a tokenizer and an unmapped type stays plain. `highlightLines`
  walks the whole file, so block comments, template literals, open HTML tags,
  CSS brace depth, and Python triple-quoted strings carry across lines; every
  literal is escaped with the same `escapeHtml` the plain view uses, and a
  line's markup is only the fixed `tok-*` classes the stylesheet colors. It
  backs both the plain text view and fenced code blocks in the rendered
  Markdown view.
- **Quick open.** `/api/files` ranks the cached index with `fuzzy.ts` and
  returns the matched character positions; the client fetches on an 80 ms
  debounce and builds rows with `textContent`, so a file name cannot inject
  markup. The index skips `.git`, `node_modules`, and symlinks, is capped by
  `maxIndexEntries`, and is cached per server for 10 s by `createFileIndex`. The
  palette is a `dialog`/`combobox`/`listbox` with `aria-activedescendant` and
  `Esc` / arrow / `Enter` handling.
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
| `paths.ts` | Decode/encode, resolve, and `realpath`-containment guard |
| `escape.ts` | `escapeHtml`, the shared HTML escaping used by every renderer |
| `highlight.ts` | First-party escape-first syntax tokenizer for the code view |
| `files.ts` | Classification (incl. Markdown), listings, text reads, sidebar tree |
| `fuzzy.ts` | Fuzzy path matching and ranking for the quick-open palette |
| `markdown.ts` | First-party escape-first Markdown-to-HTML renderer (fenced code highlighted) |
| `git.ts` | Read-only branch/dirty provider for the header chip |
| `icons.ts` | Inline SVG sprite and the per-language mapping |
| `client.ts` | The `/app.js` source (tree toggle, filter, sort, wrap, copy, quick open) and the `/theme.js` bootstrap |
| `html.ts` | Page renderers, sortable headers, and the inline CSS |
| `router.ts` | Pure request handler |
| `server.ts` | `node:http` server |
| `open.ts` | Cross-platform browser opener |

## Testing

`extensions/file-browser/` covers the path guard (traversal, encoded, NUL, malformed,
absolute, symlink escape and in-root symlink), file classification/listings/
reads/tree and the quick-open file index, the fuzzy matcher, the syntax
highlighter (language detection, fence aliases, token classes, cross-line
state, and escaping), the Markdown renderer (blocks, inline, fenced-code
highlighting, safety, and path resolution),
the icon mapping and sprite, HTML escaping/encoding/rendering, the client script
and its serving, the platform browser commands with an injected spawn, the router
(routes, `/api/tree`, `/api/files`, `?raw=1`, status codes, `Host`, `HEAD`, `/raw`
headers)
without a socket, a real `127.0.0.1:0` server, the session-port lifecycle (fixed
on first start, reused, and re-rolled after a conflict), the git status provider
(branch, dirty, detached, non-repo, failure, and TTL cache), and the command
lifecycle with injected seams.
