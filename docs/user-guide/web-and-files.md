# Web and files

This chapter covers the material that lives outside the conversation: pages on
the web, documents in the project, the project tree in a browser, and the
operating system's own applications. All of it is read-only with respect to your
project, and the network paths are bounded by the safety rules described here.

**Use this chapter when** you need current information from the web, a PDF or
office document summarised, a quick look around the project, or a file opened in
the application that understands it.

## Searching and reading the web

### What it is

Two tools let the assistant look things up:

- `web_search` finds pages and returns titles, links, short extracts, and a
  direct answer when the provider offers one.
- `web_fetch` reads one URL and returns readable text, with links kept as
  `[text](url)`, and can search inside the page.

Search works out of the box with no key and no account. If you prefer a
different provider, you can point it at a self-hosted SearXNG instance or a
Brave API key.

### When to use it

Use search for a question whose answer may have changed since the model was
trained — a version number, a release note, a current recommendation. Use fetch
when you already have the URL and want the page's content rather than a snippet.

### Walkthrough: search

1. Ask a question that needs current information:

   ```text
   search the web for the current Homebrew formula for postgres and tell me the version
   ```

2. The result lists titles, links, and short extracts, plus a direct answer when
   the provider supplies one. The call line says how many results were
   requested, not how many came back.

3. If the result is not enough, ask for a specific page to be read.

### Walkthrough: fetch a page

1. Give the assistant a URL, or point at one from the search results:

   ```text
   fetch https://pi.dev/docs and find the part about extensions
   ```

2. A long page comes back in pieces. The reply names the next offset to
   continue from; ask to continue, or give the offset.

3. `find` returns matching passages with context instead of the whole page,
   which is usually faster and cheaper than paging through it. If the match cap
   hides further hits, the result says so and names the limit.

### How a fetch is guarded

- Only `http` and `https` URLs are accepted.
- A host that resolves to a loopback, private, link-local, unique-local,
  multicast, or cloud-metadata address is refused.
- Redirects are followed manually, and every hop is checked against the same
  rules before it is fetched, so a public URL cannot redirect into a private
  address. When the final URL differs, the transcript shows the redirect target
  that supplied the text.
- Transport headers and oversized bodies are refused. The byte cap is enforced
  while the body streams, so a chunked response cannot exceed it.
- Extracted page text is data, not instructions. It is sanitized before it
  reaches the terminal, but the model still sees the text as untrusted content.

### Good to know

- The default search provider is keyless DuckDuckGo, which returns an answer and
  related topics rather than a full result list. SearXNG or Brave returns a
  conventional list; see
  [Configuration](../configuration.md#web-access--search-and-fetch).
- PDF fetching is optional. It needs the `unpdf` package; without it, a PDF URL
  is refused with an explanation instead of failing silently. Local PDFs are
  handled by [the document reader](#reading-a-document) and need no extra
  package.
- Fetched pages are cached in memory for the session, so paging and `find` do
  not refetch. `refresh: true` fetches again.
- The SSRF guard covers every redirect hop, but DNS rebinding remains a residual
  risk. Fetch pages you trust.
- Requests have a timeout and a byte cap. Both are configurable.

## Documents and files

The pack offers three ways to get at material on your computer:

| Need | Use | Where it appears |
|---|---|---|
| Read a PDF, Word, OpenDocument, RTF, or Excel file as text | The `read_doc` tool | In the conversation, paged |
| Look around the project, preview Markdown, or inspect a diff | `/browse` | A page on `127.0.0.1` |
| Open or reveal something in its normal application | `/open` | Your desktop |

## Reading a document

### What it is

The `read_doc` tool extracts plain text from a local document or
workbook inside the session. Nothing is uploaded, and no external executable is
needed; the parsers are ordinary package dependencies loaded only when that
format is read. The extension is called `file-read`.

Supported formats: PDF, DOCX, DOC, ODT, RTF, and XLSX. A workbook reads as one
`[Sheet]` heading per worksheet followed by tab-separated rows. Legacy `.xls` is
not supported; the error names the limitation and points at the supported format.

### Walkthrough

1. Ask for the document:

   ```text
   read docs/requirements.docx and list the open questions
   ```

   ```text
   summarise the sheet names in data/q3.xlsx
   ```

2. The result opens with the path, format, and size, then the text. Tables,
   images, and formatting are reduced to plain text; a workbook keeps its rows
   and columns as tab-separated text.

3. A long file comes back in parts. The reply says where to continue; ask to
   continue or request a later section.

### Good to know

- Reads are confined to the effective working directory, with the same
  symlink-aware guard as Pi's path tools. A path or symlink that resolves outside
  it is refused.
- The tool pages by code point, so CJK text and emoji stay well-formed across a
  split.
- A missing file, an unsupported extension, a disabled format, an over-size
  file, or a parser failure returns a specific error rather than partial text.
- A scanned PDF with no text layer returns no extractable text. The tool does
  not perform OCR.
- In a worktree, the effective working directory is the worktree, so documents
  and workbooks are read from there.

## Browsing a project

### What it is

`/browse` starts a read-only HTTP server rooted at the effective
working directory and opens the default browser at it. The page is a two-pane
file browser: a collapsible tree on the left, directory listings and file views
on the right, with image thumbnails, rendered Markdown, highlighted code, a
fuzzy quick-open palette, and a read-only git diff view.

### Walkthrough

1. Start it:

   ```text
   /browse
   ```

   A page opens at an address on your own machine, such as
   `http://127.0.0.1:4820`, and an `◉` chip in the footer shows the port while
   the server is running.

   <img src="../../assets/screens/file-browse.png" alt="The loopback file browser: a path filter and file tree on the left, and a rendered Markdown page on the right" width="100%">

   *The file browser: a read-only tree, a searchable path filter, and rendered
   Markdown for the selected file.*

2. Use it like a small, read-only file explorer:

   | Action | What it does |
   |---|---|
   | `↑` / `↓`, `Home` / `End` | Move through the file tree; it is one tab stop |
   | `→` / `←`, `Space` | Open a folder (or enter it), close it, or toggle it |
   | `Enter` | Open the focused file or folder |
   | `/` or `Ctrl`/`Cmd`+`K` | Quick open: fuzzy-search by path and press `Enter` |
   | `-` | Fold every folder, or expand them all again |
   | `u` | Toggle line wrapping |
   | `r` | Switch a Markdown page between rendered and raw |
   | `n` / `p` | Step through the parts of a diff |
   | `?` | Show the shortcut sheet |
   | Column headers | Sort the listing by name, size, or modified time |
   | Copy buttons | Copy a file's root-relative path or its contents |

3. Markdown files render as documents, with heading links, tables, task
   checkboxes, and highlighted code. Prose keeps a centred reading measure while
   tables take the free space to its right. A `README`'s `<details>`,
   `<summary>`, `<kbd>`, and images render through an allowlist; scripts, styles,
   and event handlers are dropped. Images show as thumbnails; other files show
   as text with syntax colouring, or as a download card when they are binary or
   over the size cap.

4. The header's theme button switches the page between light and dark and
   remembers your choice. Until you use it, the page follows the system
   preference. Beside it, a `◉ live` chip says whether the page is still in
   touch with the server; when the folder you are looking at has changed on
   disk, a `⟳ reload` control appears beside that chip. The footer reports how
   long the server has been up and how many requests it has answered. Printing a
   page gives you the light palette on paper, without the header, the tree, or
   the code view's scroll box.

5. If the project is a git repository, a change chip links to a change overview
   and per-file diffs. The comparison scope can be the last commit, the staged
   changes, or the working folder.

### Commands

The command takes a path and the usual lifecycle subcommands:

| Command | What it does |
|---|---|
| `/browse [path]` | Start at the working directory or a subdirectory of it |
| `/browse status` | Print the root and URL, or say it is not running |
| `/browse stop` | Stop the server |

### Good to know

- The browser is read-only: it cannot edit, save, or delete anything.
- It binds `127.0.0.1` only, with no authentication and no LAN exposure. A `Host`
  allowlist and the absence of CORS headers limit what another local page can
  read. [Security](../security.md) explains the boundary.
- The root is the effective working directory, so an active worktree serves the
  worktree. A path argument must resolve inside it.
- The port is chosen once per session and reused. A setting can pin one; a pinned
  port that is already in use is reported, not silently replaced.
- Read caps bound large files, long rendered documents, large images, and long
  directory listings. Over-size content becomes a download card rather than a
  frozen page.
- A tab left open keeps up: the branch chip, the change chip, and the change
  markers refresh as the working tree changes, so you can edit in Pi and watch
  the browser follow. It updates what is already on the page rather than
  redrawing it, and a listing that has fallen behind says so: when a file appears
  or goes on disk, the `⟳ reload` control appears beside the `◉ live` chip and
  reloads the page when you click it. `"live": false` in the `file-browse`
  section turns all of it off.
- The server stops when the session shuts down, and when you close the last
  page: ten seconds after the last tab goes, the port is released and the footer
  chip clears. A reload or a new tab within those ten seconds keeps it, and
  `/browse` starts it again — on the same port — whenever you want it back.

## Opening a file in its usual application

### What it is

`/open` hands a file or folder to the operating system's default
handler. `/open -r` reveals it in the file manager instead. The application runs
detached, so it stays open after Pi closes.

### Walkthrough

1. Open a file, a folder, or the current project:

   ```text
   /open docs/requirements.pdf
   /open .
   ```

2. Reveal a path in the file manager instead:

   ```text
   /open -r src
   ```

3. A missing path is reported and nothing is launched. A launcher that starts but
   then fails adds an error notification on macOS and Linux.

### Good to know

- The command needs the interactive terminal interface. The underlying
  `open_path` tool is available to codemode scripts and extensions, but is not
  active for the model by default.
- Relative paths resolve against the effective working directory, so `/open .`
  opens the active worktree when you are isolated.
- The `-r` flag must come first. A leading `@` and surrounding quotes are
  removed, so `/open @src/app.ts` and `/open @"my file.txt"` work.
- This tool opens any path on the machine, not only paths inside the project.
  That is its purpose, and it is also the risk: a file whose default handler is
  executable can run code. Open files you trust.

## Related

- [Settings and customization](./settings-and-customization.md) — the browser port, search provider, and file-read settings.
- [Security](../security.md) — the loopback and network boundaries in full.
- [Reference](./reference.md#commands) — the exact command forms.

---

[← Previous: Keep your work safe](./keep-work-safe.md) · [Guide home](./README.md) · [Next: Using it from WeChat →](./wechat.md)
