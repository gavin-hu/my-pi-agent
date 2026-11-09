# Security

## Reporting a vulnerability

Only the newest tagged release is supported, so reproduce a report against that
tag first. Use GitHub's private security advisories (`Security` → `Report a
vulnerability`) rather than a public issue, and include the affected extension or
surface, the package version, your OS, reproduction steps, and the impact you
believe it has. The boundaries below are what is in scope; a problem in Pi itself
or in a third-party dependency belongs upstream.

## Trust boundaries

The package stays inside a Pi session, but several surfaces listen, spawn, or
read from outside it. Each one is built around an explicit boundary.

### Loopback HTTP servers

One loopback server per session serves every page, and each page mounts a path prefix on
  it: [`serve`](../extensions/serve/) binds `127.0.0.1` once and hands out those prefixes,
  so the unit of exposure is the mount rather than the socket.

- [`file-browse`](../extensions/file-browse/) holds the `/files` prefix, is
  read-only, and is rooted at the working directory. Its `/events` stream carries
  the same status the page already renders — a branch, changed paths, an uptime,
  a request count — and can only be read; at most eight pages may hold it.
- [`board`](../extensions/board/)'s page mounts `/board` and is a **read view**: the
  method list is `GET` and `HEAD`, so a `POST` or a `DELETE` is refused by the envelope
  before the token is even read, and no route reaches the board store. It mints one
  128-bit token when it starts, compared in constant time, and the URL the browser was
  opened at is the whole credential — there is no cookie and no CORS. Two routes need
  no token at all: `/theme.js` and `/app.js` are the same bytes to every reader and can
  neither read nor change a card. `plan`'s review page serves the same two kinds of asset
  the same way — `/theme.js` and `/client.js` are compile-time constants, answered before
  the token is read, and neither can see a plan. Its owner-only routes — approve, cancel,
  save feedback, and the share controls — answer only on the machine serving the review: a
  shared link is a reviewer's link whatever token it carries, so a request whose socket peer
  is not loopback is refused before the route runs. Because a page is one per repository, a second
  session reaches it through the note the serving page leaves beside the cards
  (`page.json`, owner-only): the port, the seat, and that token. The page closes on
  `/board stop`, a minute after its last tab leaves, or at session shutdown. Writing a
  card is the tools' work, made as the session that called them, never as the page:
  `claim`, `reclaim`, `drop`, and `assign` confirm in the terminal because a browser is
  not an identity.
- [`plan`](../extensions/plan/)'s browser review mounts `/plan/<id>`, is
  tokenized, and gives its prefix back on the owner's save or cancel, the owner's page
  going away, or session shutdown. Sharing asks that mount for a second listener on one address
  this machine has, only while the owner has sharing on; it serves the same routes
  under reviewer tokens that may comment and nothing else. Each token is one link
  and binds the one name its comments are signed with on its first post, so a link
  cannot write under another reviewer's markers. A link is revoked alone, and
  **Stop sharing** closes the listener and revokes every link.

The loopback socket never leaves `127.0.0.1`; the only wider bind is the share
listener the owner starts and can revoke, and it answers only the one address the
share dialog printed, carrying that one page's prefix. All three answer from one shared
policy in `lib/http` — the
same CSP (which refuses to be framed), the same `Host` allowlist shape, the same
event-stream headers, and the same bind/close rules. The pages that can write
share more than that: `envelopeRefusal` orders the method, `Host`, and origin
checks once, `requireJsonBody` refuses a body a form could send, and `mintToken`
with `tokenMatches` is the one credential, compared in constant time — so the two
mutating pages cannot drift into different envelopes. A remote turn (for example
over WeChat) cannot reach them; `/plan list`'s Enter refuses there instead of opening a
server nobody can use.

### Worktree and shell isolation

[`worktree`](../extensions/worktree/) rebinds the session's working root and
guards against paths that escape it. The same shell-escape rule
(`lib/shell.ts`) backs [`plan`](../extensions/plan/)'s read-only git guard, so a
command that would leave the sandbox is rejected rather than run. Cleanup never
discards a worktree that still holds work.

### Read-only plan mode

[`plan`](../extensions/plan/) classifies tools with a default-deny policy
(`lib/policy.ts`) driven by the MCP `readOnlyHint`. Unknown tools are denied,
`powershell` is blocked outright, and shell access is limited to read-only git
commands. The only permitted write is the plan file itself, which can only be
created inside the plans directory and never through a symlink.

### Local file confinement

[`file-browse`](../extensions/file-browse/) serves only from its root, and that
root is its boundary. The readers are not confined: the built-in `read`, `grep`,
`find`, and `ls`, and [`file-read`](../extensions/file-read/)'s `read_doc`, read
whatever the process can, with symlinks resolved first. `read_doc` is why that
reach is deliberate — a document another extension wrote outside the checkout, a
WeChat attachment under the agent directory say, is otherwise unreachable — but the
boundary is the same for all of them: the OS file permissions.

Inside an active worktree, [`worktree`](../extensions/worktree/) refuses a `write`,
an `edit`, or an output redirection that resolves outside the checkout, and
`guard.blockReadEscapes` — off by default — extends that to the readers and input
redirection. The containment predicates those surfaces share live in `lib/path.ts`.

### Outbound web access

[`web-access`](../extensions/web-access/) checks every redirect hop against
private and internal address ranges before following it, so `web_fetch` cannot
be pointed at loopback, link-local, or metadata endpoints.

[`bytefly`](../extensions/bytefly/) asks Pi's package manager which configured
packages are behind, so it runs the same npm/git checks Pi would run. When this
package is one of them, it also makes one fixed `GET` of npm's `latest`
document to name the version and release URL. Neither path carries session data,
and `PI_OFFLINE` turns both off.

### Child processes and remote control

- [`subagent`](../extensions/subagent/) launches a child `pi` process; its
  `readOnly` mode passes the workspace readers, `read_doc`, and `web_search` — no
  writing tool and no `web_fetch`, because a fetch is an outbound channel. That
  narrows what a child may do; it is not a sandbox: `read_doc` still reads any
  document the process can, with the OS permissions that go with it.
- [`wechat`](../extensions/wechat/) answers only the stored account's owner — the
  chat is that Pi session, with its tools — and keeps credentials under
  `<agent-dir>/wechat/` with mode `0600`. Anyone else is refused and counted, and
  the `send_wechat` tool can message only the owner.
- [`memory`](../extensions/memory/) injects notes into the model context; note
  text is sanitized at the boundary like any other model- or file-authored
  text.

### Model- and file-authored text

Any text that reaches a widget or the terminal passes through `sanitizeLine`
(or `stripControlChars` for multi-line text) in `lib/format.ts` first, so control
characters cannot inject terminal sequences.
