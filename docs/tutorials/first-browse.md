# Browse your working directory

`/browse` opens a read-only file browser for the project you are working in. It is
the fastest way to read a Markdown file as a page, look at an image, or check a
diff without leaving the terminal.

## Open it

```text
/browse
```

The server starts at the session's working directory, prints its address, and
opens your browser. The page is two panes: a collapsible path tree on the left,
the current folder or file on the right. Running `/browse` again opens the page
it already serves instead of starting a second one.

## Read a file

Click a file in the listing, or jump straight to it with quick open — `Ctrl+K`
(or `Cmd+K`) and type part of the path:

```text
uploader.ts
```

The right pane then shows:

- **Markdown** rendered as a page, with a one-click raw view;
- **code** with keywords, strings, numbers, and comments coloured, in either
  theme;
- **images** as thumbnails, and too-large or binary files as a download card.

The toolbar copies the file's path, its contents, or a `path:12-30` reference for
the lines you selected — which is the form you can paste back into a prompt.

## Check what changed

The diff view reads the working tree, the staged changes, or `HEAD`:

- the **changes** chip opens the overview, with one line per file;
- `n`/`p` jump between hunks of one file's diff;
- the markers come from git, so nothing is written and nothing is staged.

## Let it follow you

The page re-roots itself when the session moves: enter a worktree with
`worktree enter` and the open page reloads onto the new tree, on the same URL and
port. If you started it on a subdirectory, that subdirectory is kept when the
new tree has one.

While the page is open it keeps its branch and change markers current. A file
that appears on disk does not join the listing by itself — the page offers
`⟳ reload` instead, so a folder you are reading does not rearrange under the
cursor.

## Close it

```text
/browse stop
```

Closing the last tab does the same after ten seconds. The session's port is the
project's own, so a bookmark still lands here next time.

## Where to go next

- [`file-browse`](../extensions/file-browse.md) — keys, caps, and every setting.
- [`serve`](../extensions/serve.md) — the one server behind this page.
- [`worktree`](../extensions/worktree.md) — the checkout the page follows.
