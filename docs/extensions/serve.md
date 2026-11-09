# serve — the one local server behind every page

Every browser surface in this package — the board, the file browser, a plan
review — answers on one loopback address, and `serve` owns it. There is nothing to
start: the first page that opens binds the port, and the last one to close gives
it back.

- **One address per session**, so a bookmark, a firewall rule, and a port to
  remember are one thing.
- **The port is the project's own** — its repository name hashed into
  `4780`–`5779` — so a page you bookmarked still opens after a restart.
- **Loopback only.** The one exception is a review you share, which borrows a
  single LAN address on request.
- **A chip while it runs**: `◉ <port>` in the footer, gone when the last page
  closes.

## What you can do

| What you want | What to do |
|---|---|
| Open the file browser | `/browse` |
| Open the board | `/board` |
| Read a saved plan in the browser | `/plan list`, then `Enter` |
| Find the port the session is on | the `◉ <port>` chip in the footer |
| Keep a URL across restarts | nothing — the port is the project's own |
| Pin a specific port | set `serve.port` in `bytefly.json` |
| Share one review with a teammate | **Share** on the review page, not here |
| Free the port | close the last page, or stop it from its own command |

## Try it

```text
/browse
```

The page prints the address it opened, on the project's port, and the footer
shows the chip while it is open. `/board` and a plan review then answer on the
same one.

## Reference

The server holds prefixes, not pages; each is claimed by the extension that
serves it.

| Prefix | Served by |
|---|---|
| `/files/` | `file-browse` — the tree, file pages, its script, rewritten Markdown links |
| `/board/` | `board` — the read-only board page, token in the query |
| `/plan/<id>/` | `plan` — one review, one id, so two never share a namespace |

Anything else is a plain `404`; a prefix without its trailing slash redirects to
the slashed form, because a page's own links are relative to its directory.

**The port.** The default is `0`: the project's own number, with an OS-chosen one
if it is taken. A positive `serve.port` pins the session's server so a bookmarked
address survives a restart; a pinned port another process holds is reported by
name instead of being moved silently. A second session of the same repository
prefers the same number and takes an OS-chosen port when the first holds it, so
two sessions never fight over one address.

**Security.** Each page keeps its own token, its own `Host` allowlist, and its
own method list — being on one server does not share a credential. A page opens
one stream and the token is checked on it like any other route. The single
exception is a shared review, which asks for a listener on one LAN address and
carries only that review's prefixes.

## Limits

- A page needs `serve` loaded: without it every page refuses with a sentence
  naming the extension, rather than binding a rival socket.
- Two different projects can hash into the same port; the second start takes an
  OS-chosen one, so its bookmark moves until one of them sets `serve.port`.
- Two checkouts of one repository at once share the number, so only the first
  keeps the address a bookmark names.
- It is not a general web server: loopback, a page's own routes, and one optional
  LAN address per shared page, nothing else.
- It serves no page of its own and registers no tool or command.

## Settings

| Key | Default | What it does |
|---|---|---|
| `port` | `0` | `0` takes the project's own port; a positive value pins it so a bookmarked address survives a restart. |

It lives in the `serve` section of `bytefly.json`
([configuration](../configuration-reference.md#serve--the-sessions-page-server)). To switch
`serve` off, toggle it in `/bytefly` — every page that needs it then says so
instead of opening.

## Learn more

- [`file-browse`](../extensions/file-browse.md) — the page on `/files/`.
- [`board`](../extensions/board.md) — the page on `/board/`.
- [`plan`](../extensions/plan.md) — the review page.
- [Security](../security.md) — what a shared link exposes.
