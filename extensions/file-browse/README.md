# file-browse — view the working directory in a browser

`/browse` starts a **read-only** HTTP server rooted at the effective working
directory, opens the default browser at it, and prints the URL. The page is a
two-pane file browser: a collapsible path tree on the left, directory listings
and file views on the right, with image thumbnails, rendered Markdown,
highlighted code, per-language icons, a fuzzy quick-open palette, and a
read-only git diff view. It is
bound to `127.0.0.1`
and ships no dependencies — `node:http` plus one small vanilla script.

<img src="../../assets/file-browse.png" alt="The loopback file browser, showing the path filter, the file tree, and a rendered Markdown preview" width="100%">

```bash
pi --extension ./extensions/file-browse   # load just this extension
pi -e .                                    # load the whole @gavin-hu/my-pi-agent package
```

## What it does

- **One-command browsing.** `/browse` starts the server, prints the URL, and
  opens the browser (unless `autoOpen: false`).
- **Two-pane UI.** A server-rendered tree, directory listings, and file pages,
  progressively enhanced by one first-party script (filter, lazy tree
  expansion, thumbnail fallback). A folder folds from its twisty, and a
  `fold all` / `expand all` button beside the filter folds the whole tree at
  once. The tree scrolls in
  its own pane with quick open and the filter pinned above it; below 860px it
  collapses into a `Files` disclosure above the listing. A hairline progress bar
  tracks whichever column is scrolling (the card body for a file or diff, the
  main column otherwise), and the served folder names the root page.
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
  tables, code, inline and reference links, bare-URL autolinks, and images, with
  a one-click **raw** view (`?raw=1`). The page fills the card, so the scroll
  bar sits at the card edge; headings, prose, and images keep a centred reading
  measure of at most 1012px. Code blocks stay
  inside that column; tables start at it and take the free gutter to its right,
  and a table wider than the pane scrolls, its right edge fading until the last
  column is reached. A task list's checkbox is drawn by the page, so a done
  item carries the success colour in both themes. Tables size their columns to
  the content, and named and numeric character references are decoded. A
  README's raw HTML is re-emitted through an allowlist (`<details>`,
  `<summary>`, tables, `<kbd>`, images), so it renders without becoming an
  injection path. Fenced code blocks are syntax-highlighted when the fence
  names a supported language. Headings get stable anchor ids, so in-document
  `#anchor` links work. Raw HTML in the source is escaped, never executed, and
  external images are shown as links rather than fetched.
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
- **Keyboard.** `/` or `Ctrl/Cmd+K` opens quick open, `-` folds or expands
  every folder in the tree, `u` toggles line wrapping, `r` switches rendered and
  raw Markdown, `n`/`p` step between a diff's hunks, and `?` opens a shortcut
  sheet. A diff's hunk headers pin to the top of the code viewport while its
  body scrolls.
- **Read-only and loopback-scoped.** No editing, no writing, no LAN exposure.
- **Git context.** A read-only header chip shows the checked-out branch (or
  detached head) and reflows on narrow screens. Uncommitted changes are stated
  once, by the changes chip below; turn the diff view off (`gitDiff: false`) and
  the header reports no changes at all.
- **Git diff view.** A `● N changes +A −D` chip links to `/diff`, a change
  overview with `git diff --stat` and a per-file status table, and `/diff/<rel>`
  renders one file's unified diff, whose head carries its own `+A −D` and hunk
  count. Changed lines are syntax-highlighted with the
  file's language, and dirty files and their directories carry a marker in the
  listing and the tree. The scope is switchable between `head` / `staged` /
  `worktree`; untracked files show as all-add, an unborn `HEAD` falls back to the
  index, and a non-repository is a plain empty state. Read-only, capped, and
  rendered with the shared diff colors.
- **Live status.** A page left open keeps up with the session: a `◉ live`
  chip beside `read-only` says whether status is flowing (green), still
  connecting (accent), stalled (amber, after three missed frames), or offline
  (red); the branch chip, the `● N changes +A −D` chip, and the change markers in
  the tree and the listing update in place; and the footer line reports `up 2m
  14s · 37 requests`. The chip names its state and never counts, so nothing is
  repainted between frames. One Server-Sent Events stream per page carries it, on
  the same loopback server, so nothing extra is opened and nothing is written;
  that stream is also how the server notices the last page closing its window,
  after which it stops listening.
- **No dependencies.** `node:http` plus the inline sprite, CSS, and client
  script.

## Commands

```bash
/browse            start at the working directory, open the browser, print the URL
/browse <path>     start with a subdirectory of the working directory as the root
/browse status     print the root and URL, or "not running"
/browse stop       stop the server
```

- The root is the effective cwd, so an active `worktree` session serves the
  worktree. `<path>` must resolve inside it.
- The port is fixed for the session: the first `/browse` picks a random port
  in `4780`–`5779` and every later `/browse` in that session reuses it, so the
  URL stays stable across roots and restarts. Set `"port"` to pin an explicit
  port; a busy port is reported, not silently changed.
- Starting while already running with the same root reprints the URL without
  restarting; a different root (or a changed pinned port) restarts the server.
- The server is closed when its last page has been gone for ten seconds, so
  closing the browser window ends the session's browse server and `/browse`
  starts it again on the same port. A reload or a new tab inside that grace keeps
  it. `session_shutdown` closes it too, and `/browse stop` closes it at once.

### Status

While a server is running, the extension publishes a two-tone `◉ <port>` chip
(a green circle-dot and a blue port) under the shared `browse` status key. The
[`bytefly`](../bytefly/) extension routes it to line 1's right zone
beside `⎇ branch` and `⑂ worktree`; it
is cleared on stop and on `session_shutdown`. The chip is session-local: it
reflects only this session's server, with no cross-session sharing.

The page has its own live status, which is what a left-open tab reads. The
header chip starts hidden and is painted by the client from `/events`: `◉ live`
in the success colour while frames arrive, `◉ connecting` before the first
one, `◉ stale` in the warning colour when three intervals pass without a frame
on an open connection, and `◉ offline` in the danger colour once the stream
errors. The chip names its state rather than counting, so it is repainted only
when that state changes. The same frame carries the branch (or detached head), the
uncommitted-change totals and paths, the server's uptime, and the requests it
has answered, so the branch chip, the changes chip, the markers, and the footer
line are painted from one snapshot rather than four requests. Losing the stream
leaves everything the page last showed in place: it is read-only, so a stale
label is never a stale action. `"live": false` turns the whole surface off — no
chip, no stream, no `/events` route — and so does JavaScript off.

The stream is also how the server knows a page is still there: when the last one
leaves, the port is released after ten seconds and the chip is cleared, because
nothing is left to serve. That is why a page with JavaScript off — or with live
status off — never counts as a reader, and the server then waits for
`/browse stop` or the end of the session.

### The page

The page is keyboard-first, and the tree is one tab stop rather than two per
folder:

| Key | What it does in the tree |
|---|---|
| `↑` / `↓` | Move between the rows on screen |
| `→` | Open a folder (reading its children first if needed), or enter it |
| `←` | Close the folder, or step out to its parent |
| `Space` | Open or close the focused folder |
| `Enter` | Follow the focused row's link |
| `Home` / `End` | First or last row on screen |

The folder's own link carries `aria-expanded`, so a screen reader hears its
state once; the twisty beside it is a pointer control kept out of the tab order.
A mouse click moves the tab stop to that row, so `Tab` comes back to where you
were. Elsewhere the page keeps its own keys: `/` or `Ctrl`/`Cmd`+`K` for quick
open, `-` to fold, `u` to wrap, `r` for raw Markdown, `n`/`p` between diff hunks,
and `?` for the sheet, whose dialog now traps `Tab` and returns focus to its
button.

Printing is supported: the paper gets the light palette whatever the screen is
showing, the chrome and the tree are dropped, and a file or diff prints whole
instead of inside its scroll box.

## Routes

| Route | Result |
|---|---|
| `/`, `/browse[/<rel>]` | tree + directory listing |
| `/view/<rel>` | tree + file page (text, Markdown, image, binary, or over-size) |
| `/view/<rel>?raw=1` | raw Markdown/text source instead of the rendered view |
| `/raw/<rel>` | raw bytes, streamed; downloads and image sources |
| `/diff[?mode=head\|staged\|worktree]` | changed-file overview with `--stat` |
| `/diff/<rel>[?mode=…]` | one file's unified diff |
| `/api/tree?path=<rel>` | JSON children for lazy tree expansion |
| `/api/files?q=<query>` | JSON fuzzy path matches for the quick-open palette |
| `/events` | Server-Sent Events stream of `status` frames for the open page |
| `/app.js` | the first-party client script |
| `/theme.js` | the pre-paint theme bootstrap |
| `/favicon.ico` | `204` (the icon is a data URI) |

## Configuration

The `file-browse` section of the shared `bytefly.json`, merged from the global
document and the project document (project wins):

```jsonc
// bytefly.json → "file-browse"
{
  "port": 0,                 // 0 = one random port fixed for the session
  "autoOpen": true,          // open the browser on start; false for headless
  "maxFileBytes": 1048576,   // larger files show a download card only
  "maxThumbBytes": 5242880,  // larger images get an icon, not a thumbnail
  "maxTextLines": 5000,      // rendered lines before truncation
  "maxDirEntries": 2000,     // listed entries before truncation
  "thumbnails": true,
  "markdown": true,          // render Markdown files as formatted HTML
  "markdownHtml": true,      // re-emit sanitized raw HTML in rendered Markdown
  "maxIndexEntries": 20000,  // files collected for quick open before truncation
  "gitDiff": true,           // offer the read-only diff view
  "diffContext": 3,          // unified diff context lines
  "maxDiffLines": 4000,      // diff lines rendered before truncation
  "live": true,              // stream live status to open pages
  "liveIntervalMs": 3000     // ms between status frames while a page is connected
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
- **CSP.** Pages allow only same-origin scripts and inline styles, and refuse to
  be framed (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), so a local page
  cannot clickjack the controls or re-point relative URLs through an injected
  `<base>`; the policy comes from `lib/http/headers.ts`, shared with `plan`, so
  the two surfaces cannot drift. `/raw` uses
  `default-src 'none'; script-src 'none'; sandbox` plus `nosniff`, so a served
  SVG/HTML file cannot execute.
- **Markdown safety.** Rendered Markdown is escape-first, and raw HTML passes an
  allowlist (`raw-html.ts`): only known elements and attributes are re-emitted,
  rebuilt from the parsed names rather than copied, so `script`, `style`,
  `iframe`, `svg`, event handlers, `style=` and `class=` never reach the page.
  Link schemes are allowlisted (`javascript:`/`data:` dropped), an external
  image renders as a link instead of loading, and open elements are balanced at
  the end of the document so an unclosed `<div>` cannot swallow the page chrome.
  A suppressed element (`script`, `style`, `svg`, …) is dropped with its body;
  any other unknown tag is escaped and stays visible. `markdownHtml: false`
  restores escape-only rendering. The page CSP keeps the rest inert.
- **Highlighting safety.** The highlighter escapes every literal before it
  wraps it in a token span, so a code file's content cannot inject markup or
  attributes; only the fixed `tok-*` class names reach the page.
- **Event stream.** `/events` is a `GET` on the same loopback server, behind
  the same method and `Host` checks, and it only reads: the frame is the branch,
  the change paths, an uptime, and a request count, all of which the page it
  feeds already renders. It carries no page policy (`text/event-stream` is not a
  document), sends `Cache-Control: no-store`, and cannot be cached or replayed.
  A tick runs only while a page is attached, and the timer is `unref`ed, so an
  idle server does no work and a forgotten tab cannot hold the process open.
- **Caps.** `maxFileBytes` (inline rendering), `maxTextLines` (rendered lines),
  `maxThumbBytes` (thumbnails), and `maxDirEntries` (listings) bound every read.
- **Git reads.** The header chip and the diff view run read-only git
  (`rev-parse`, `status --porcelain=v1 -z`, `diff --stat`, `diff -U<n>`) with a
  timeout and a short cache; any failure simply omits the chip or the diff. A
  per-file diff sets `GIT_LITERAL_PATHSPECS=1`, so a filename containing glob
  characters is matched literally.
- **Read-only.** Nothing is ever written.

## Limitations

- Syntax highlighting covers the built-in language set below; any other text
  type renders exactly as before. State that the tokenizer does not carry
  across lines (shell heredocs, interpolation inside a template literal) is
  approximated rather than parsed.
- Live status updates what the page already contains: the header chips, the
  markers on the rows it rendered, and the footer line. A file that appears on
  disk joins the listing on the next reload, the `/diff` table and a file page's
  `changes` action stay page-load snapshots, and the branch chip is only patched
  when the page was served inside a repository.
- `/browse` has no auth; a malicious local page could probe the port. The `Host`
  allowlist and the absence of CORS headers mitigate reads, and the server is
  read-only.
- Serving the root exposes whatever is on disk to the local user who started it;
  this is intentional and scoped to loopback.

## Non-goals

- No editing or writing from the browser.
- No third-party assets: the Markdown renderer, its raw-HTML sanitizer, and the
  syntax highlighter are first-party, so raw HTML in a Markdown file is
  allowlisted and never executed.
- No auth and no LAN exposure: loopback only.
- Not a general static-file server: the root is confined to the effective cwd.

## Pi integration

| Integration point | How |
|---|---|
| Command | `/browse` registers a single command from the factory; no tools are exposed. |
| State | The running server, its root, and the session port live in a module-local closure; nothing is persisted and no session entries are written. |
| Lifecycle | The factory opens no socket; the server is created on `/browse` and closed idempotently by `/browse stop`, by `session_shutdown`, and once its last page has been gone for the idle grace, which also ends every attached status stream. |

## Design notes

- **Lifecycle.** `/browse` resolves `resolveEffectiveCwd(ctx.cwd)`, loads config,
  selects the port, parses args, and `await createFileServer(...)`: `realpath`
  the root, bind `127.0.0.1`, await `listening`, return `{ url, port, root,
  close }`. The port is chosen once for the session: a pinned config `port`
  wins, otherwise a random port is drawn and cached after the first successful
  bind, so later starts reuse it (a conflict is reported and the next `/browse`
  rolls another). `/browse stop` and `session_shutdown` await the idempotent
  `close()`; `session_shutdown` also clears the cached port. The page is the
  server's only reader, so the channel reports the last page's departure after
  `IDLE_STOP_MS` and the command closes the server and clears the chip — the
  cached port survives, so the next `/browse` binds the same one.
- **Pure routing.** `handleRequest(context, method, rawUrl, headers)` validates
  method and `Host`, parses the URL, matches a route, and runs every path
  through `paths.ts`. It returns a plain `ServeResponse`, so routing is tested
  without a socket; `server.ts` is the only part that binds a port.
- **Progressive UI.** The page is server-rendered HTML with an inline style
  block and inline SVG icons. `client.ts` enhances it: the filter hides
  non-matching rows while keeping ancestors, disclosure triangles lazily
  `fetch("/api/tree")`, broken thumbnails fall back to the category icon, the
  listing headers sort in place, the wrap toggle is remembered, and the copy
  buttons use the clipboard. On wide screens the tree is its own scroll pane
  under the pinned filter and quick-open trigger; the sidebar is a `<details>`
  whose content wrapper has no definite height, so the panel fills it
  absolutely and the tree flexes inside. Without JS the page still browses and
  renders Markdown, and the JS-only controls (filter, disclosure, actions, quick
  open) are hidden; the sort buttons lose their pointer so they do not look
  live. The palette is the shared Bytefly web theme (`lib/web/tokens.ts`),
  derived from the `bytefly-dark`/`bytefly-light` terminal themes; it follows
  `prefers-color-scheme` until an explicit choice sets `data-theme` on the root:
  `/theme.js` applies the saved choice in the head before first paint, and the
  header toggle flips and stores it (`pi-web-theme` in `localStorage`, the key
  shared with plan's review page).
- **Markdown rendering.** `markdown.ts` is a first-party, escape-first renderer
  for the constructs that show up in repository READMEs. It emits only a known
  tag set, escapes every literal character, allowlists URL schemes (dropping
  `javascript:`/`data:`), rewrites local links and images to `/view`/`/raw`, and
  renders an external image as a link instead of loading it (the page CSP is
  `img-src 'self' data:`). Link reference definitions (`[id]: url`), including
  the full `[text][id]`, collapsed `[text][]`, and shortcut `[text]` forms, and
  numeric and common named character references are resolved. The Rendered/Raw
  switch is a server-side `?raw=1`
  link, so it works without JavaScript. Headings are demoted one level so the
  card title stays the page's only `h1`, and each gets a slug `id` (unique in
  the document). Set `markdown: false` to fall back to the plain-text view. A
  fenced code block
  whose info string names a supported
  language is highlighted through `lib/highlight.ts` (either an extension or a
  long-form alias, `fenceLanguage`); an absent or unknown language stays plain.
- **Raw HTML.** A line that starts with an allowed block tag (`<details>`,
  `<table>`, `<div>`, `<pre>`, …), a comment, or a closing tag opens an HTML
  block that runs to the next blank line; text inside it stays text, and a
  suppressed tag (`<script>`, `<style>`, `<svg>`) drops its body through the
  matching close tag. `raw-html.ts` re-emits only allowlisted elements and
  attributes: `a`/`img` go through the same `/view`/`/raw` resolution as
  Markdown, an external image becomes a link, and `class`/`style`/handlers are
  dropped. Phrasing tags are also accepted inside a line, while a block tag
  mid-paragraph stays escaped. Open elements are balanced across blocks, which
  is how a `<details>` can wrap Markdown paragraphs, and `markdownHtml: false`
  turns the whole path off.
- **Syntax highlighting.** `lib/highlight.ts` is a first-party, escape-first
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
- **Diff view.** `git.ts` extends the read-only provider set with a TTL-cached
  `git status --porcelain=v1 -z` and a per-mode `git diff`; `diff.ts` parses the
  unified diff and the porcelain records into plain view models, so `router.ts`
  and `html.ts` stay pure. `head` compares against `HEAD` (falling back to
  `--cached` before the first commit), `staged` against the index, and
  `worktree` against the index from the other side. An untracked file renders as
  all-add through `readFileView`, so binary and over-size handling is shared
  with the file view. `git diff --stat` supplies the chip totals and
  `changeDirs` derives the directory markers; the changed lines are highlighted
  per hunk by rebuilding the old and new sides for `lib/highlight`.
- **Live status.** `live.ts` builds one snapshot per tick — the git status,
  the `head` change index, the server's uptime, and its request count — and
  `frameOf` serializes it as one `status` event. `createLiveChannel` holds the
  attached pages and starts the ticker on the first attach, so an idle server
  does no work; it shares a single in-flight snapshot between pages, drops a
  page whose write fails, and stops on the last detach and on `close()`, which
  `server.ts` calls before closing the socket. The last detach also arms one
  idle-stop timer — a reload re-attaches and cancels it — and `server.ts` turns
  that into the extension's `close()` and a cleared chip. Both providers are already
  TTL-cached, so a tick re-reads at most one `git status`, and every read
  failure degrades to `null` rather than a failed frame. The event-stream
  headers and the `retry:` preamble live in `lib/http` with the rest of the
  loopback policy, shared with plan's review page. The client half is
  `live-client.ts`: one `EventSource`, one snapshot paint (`textContent` only,
  never markup), one staleness timeout armed per frame, and a `pagehide` cleanup.
- **Streaming responses.** The server streams `filePath` responses and
  suppresses bodies for `HEAD`, so large `/raw` files are not buffered.
- **Root confinement over feature breadth.** The root is deliberately confined
  to the effective cwd rather than serving an arbitrary directory, so a
  worktree session serves the worktree and nothing above it.

## Files

| File | Purpose |
|---|---|
| `index.ts` | `/browse` command, running-server closure, shutdown cleanup |
| `config.ts` | Config defaults, validation, global/project merge |
| `paths.ts` | Decode/encode, resolve, and `realpath`-containment guard |
| [`../../lib/escape.ts`](../../lib/escape.ts) | `escapeHtml`, the shared HTML escaping used by every renderer |
| [`../../lib/highlight.ts`](../../lib/highlight.ts) | First-party escape-first syntax tokenizer for the code view (shared with `plan`) |
| [`../../lib/web/index.ts`](../../lib/web/index.ts) | The shared Bytefly web brand system: tokens, base, components, layout, runtime, and markup |
| `files.ts` | Classification (incl. Markdown), text reads, and one page-level walk (`directoryView`) that returns a directory's listing and its sidebar tree |
| `diff.ts` | Pure unified-diff and porcelain-status parsing for the diff view |
| `fuzzy.ts` | Fuzzy path matching and ranking for the quick-open palette |
| `markdown.ts` | First-party escape-first Markdown-to-HTML renderer (fenced code highlighted; raw HTML through `raw-html.ts`) |
| `raw-html.ts` | Allowlisted raw-HTML sanitizer: element/attribute policy, suppressed bodies, and cross-block balancing |
| `urls.ts` | Shared link/image URL policy: scheme allowlist and `/view`/`/raw` rewriting |
| `git.ts` | Read-only branch/dirty provider for the header chip |
| `icons.ts` | Inline SVG sprite and the per-language mapping |
| `client.ts` | The `/app.js` source: sort, wrap, copy, hunk navigation, reading progress, and the page keymap |
| `tree.ts` | The sidebar block: path filter, fold-all, lazy tree loading, and the tree's keyboard model (interpolated into `client.ts`) |
| `palette.ts` | The quick-open palette: fuzzy search, the combobox wiring, and the `window.bfPalette` contract (interpolated into `client.ts`) |
| `live-client.ts` | The client's live status block: the event stream, the chips, the markers, and the footer line (interpolated into `client.ts`) |
| `live.ts` | The live status snapshot, its frame, and the fan-out channel that ticks it |
| `styles.ts` | The page-only `browse-*` stylesheet (the `bf-*` kit comes from `lib/web`) |
| `html.ts` | Page renderers: the shared shell, the two-pane layout, the listing, the cards, and the diff body |
| `router.ts` | Pure request handler: routes, the `/raw` sandbox policy, and the error page |
| `server.ts` | `node:http` server: this extension's handler over the shared bind, writer, and close |
| [`../../lib/http/index.ts`](../../lib/http/index.ts) | Loopback HTTP layer shared with `plan`: page/script/JSON/event-stream headers, `ServeResponse`, the request-envelope helpers, bind/respond/close, and `openEventStream` |
| [`../../lib/browser.ts`](../../lib/browser.ts) | Cross-platform browser opener (shared with `plan`) |

## Testing

`extensions/file-browse/` covers the path guard (traversal, encoded, NUL, malformed,
absolute, symlink escape and in-root symlink), file classification/listings/
reads/tree and the quick-open file index, the fuzzy matcher, the syntax
highlighter (language detection, fence aliases, token classes, cross-line
state, and escaping), the Markdown renderer (blocks, inline, fenced-code
highlighting, safety, raw HTML, and path resolution), the raw-HTML sanitizer
(allowlist, suppressed bodies, attribute policy, balancing, and a seeded
invariant test over fragment soup),
the icon mapping and sprite, HTML escaping/encoding/rendering, the client script
and its serving, the platform browser commands with an injected spawn, the router
(routes, `/api/tree`, `/api/files`, `?raw=1`, status codes, `Host`, `HEAD`, `/raw`
headers, and the `/diff` view routes and mode validation)
without a socket, a real `127.0.0.1:0` server, the session-port lifecycle (fixed
on first start, reused, and re-rolled after a conflict), the git status provider
(branch, dirty, detached, non-repo, failure, and TTL cache), the git diff parser
and provider (line kinds, line numbers, status and rename parsing, mode
filtering, untracked all-add, unborn-HEAD fallback, literal pathspec, and TTL
cache), the diff renderers (highlighted changed lines, marker sets, and chip
totals), the live status feed (snapshot fields, degraded providers, the frame,
and the channel's ticker driven by an injected timer, plus the idle stop armed on
the last detach and cancelled by the next page or by `close()`), the `/events`
route and
its 404 when the channel is off, a real socket that reads a page's first frame
and the ticker's next one and sees the stream end when the server closes, the
live chrome a page renders when on and not when off, and the command
lifecycle with injected seams.
