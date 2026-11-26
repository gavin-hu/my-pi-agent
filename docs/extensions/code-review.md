# code-review — review a diff as a page, line by line

<img src="../../assets/screens/code-review.png" alt="The review page: the changed-file rail as the kit's collapsible sidebar — a search field, an All/Commented switch, and over the rows the file count, how much of the review is marked and the scope's totals — and the diff's full column, one draft comment under the line it names, a commented file on its warn paper and a reviewed one on its success paper, the scope switch and Send feedback at the control row's right end, and the footer's comparison alone" width="1280" height="910">

A branch, an uncommitted change, or the index, served as a page you can read
line by line and comment on. The comments are the model's next turn — nothing
is written to your tree.

- **Use it for** the change you would otherwise review in a terminal with
  `git diff`, where the note you want to leave has nowhere to go.
- **`/review`** serves the page and opens it; **`code_review`** is the model's
  side of it — open, read, and close.
- The page is loopback-only and carries a token, so nothing else can post.

## What you can do

| What you want | What to do |
|---|---|
| Serve a review of the branch | `/review`, or `code_review` with `action: "open"` |
| Review the last commit, everything uncommitted, the index, or the tree | `/review last`, `/review head`, `/review staged`, `/review worktree` |
| Read one file of it | **view file** on a file's head, which serves its whole text from the review |
| Comment on a line | click a gutter number, then **comment** — or `c` with a line selected |
| Comment on a range | click one gutter, Shift-click another |
| Copy a line reference | select lines, then **copy ref** — it copies `path:12-30` |
| Mark a file read | its **reviewed** box, or `m` |
| Send the notes to the session | **Send feedback** |
| Read what was sent | `code_review` with `action: "comments"` |
| Close the page | `/review stop`, `code_review` with `action: "close"`, or the last tab leaving |

## Try it

```text
/review
review: my-pi-agent vs origin/main — 5 files
review: http://127.0.0.1:4781/review/new
```

Press **Send feedback** in the page; the session reads one notice at its next turn:

```text
[CODE REVIEW]
1 review comment sent:
gateway.ts:6-7 — Name the bound where the caller can read it…
Run `code_review` action "comments" for all of them.
```

## Reference

`code_review` has four actions; `/review` drives the page.

| Action | What it does |
|---|---|
| `open` | Serve the page and hand back its address; `scope` and `base` choose the comparison |
| `status` | What the page shows: its address, scope, files, comment counts, and the reason when it has no diff |
| `comments` | Every comment the reviewer sent, with file, line, and side |
| `close` | End the page; refused while comments are still drafts |

**The five comparisons.** `base` reads `<base>...HEAD`, the branch against the
line it left; `last` reads `HEAD~1...HEAD`; `head` (shown as **uncommitted**)
reads the tree against `HEAD`, so the index and the working tree arrive together
with untracked files; `staged` reads the index; and `worktree` reads the working
tree alone, untracked files included. The base ref is the `base` key, else the default
branch — `origin/HEAD`'s, else a local `main` or `master` — read through its `origin/`
ref. A ref that does not resolve, one over 200 characters, and no default branch at all
are each refused by name, by `/review` and the page.

**The page.** One page per session, at `/review/`. Its id is minted by the first
write, so looking costs nothing; the token rides the query and the id the address. A
comment is a draft until **Send feedback** marks it sent, which also writes the one
you are typing; **reply** keeps a comment under its comment, one level deep, and one
whose comment was deleted reads as one. The files are the shell's sidebar — a search,
**All** / **Commented**, one row per file — folding below 900px; `wrap` wraps at any
width, and narrowing hides rows, never sections. The rail's head carries the facts and
the progress; the footer the comparison. It follows its own stream: a write in one tab
repaints the others, and a frame under an open composer is held. A frame under the
send dialog re-reads the list it is about to send; an emptied dialog stays open
saying there is nothing left to send rather than closing under the reader. The last tab
leaving ends it 1.5 s later so a reload fits. Nothing watches the tree: **comment** asks
the revision the page would render now, so a moved diff opens no box; the write refuses.

**One file at a time.** `?file=<path>` turns the page into that one file's diff: the
rail shows that file and an **all files** link back, while the count and the progress
still name the whole scope — `1 of 2 files` for a page drawing one of two — and the
snapshot and its token stay the whole scope's. The head's **view file** serves the
whole file at `/review/file?scope=<s>&path=<rel>`: only a listed path, read under the
reviewed checkout, on the diff's gutter, with a way back. `n` and `p` step its hunks;
`[` and `]` step the whole review's, each landing below the pinned head.

**What a comment anchors to.** A path, a side, and a line the comparison draws — a span's end and the rows
it quotes — checked against the snapshot, refused once the tree moves; a send, a delete and a mark land
anyway. A surviving row anchors to its marked new number; a deleted line's ref says `path:5 (old)`.

## Limits

- The review is the session's. Its comments live as long as the page does; an unsent
  draft stays in this tab, per line, and sending keeps both — notice and `code_review`.
- One page per session. A scope change is refused while the page holds a draft or a
  mark, by one rule for `/review`, the tool and the tabs; sent comments never hold it.
- A focused page (`?file=`) hides the other files without forgetting them, and a
  moved diff can leave a comment or an unsent draft on a line no hunk shows: both
  still send, and the stranded one is listed above the diff, to delete or discard.
- At most 200 comments of 2,000 characters each, 200 changed files, and 4,000
  diff lines per file; the page says what a cap left out.
- In a repository with no commits yet, `staged` and `worktree` still render a page;
  `base`, `last` and `head` say the commit they compare is missing — `head` too, since
  `git diff HEAD` needs one and `--cached` does not.
- The page needs `git`, `serve`, and a local browser; without `serve` the tool says
  the session has no port, and a launcher that cannot start is reported with the address.

## Settings

`base`, `diffContext`, `maxDiffLines`, and `maxFiles` come from the `code-review` section of
`bytefly.json` — see [Configuration reference](../configuration-reference.md#code-review--what-a-review-compares).

## Learn more

- [`serve`](./serve.md) — the session's one port, which the page answers on.
- [`file-browse`](./file-browse.md) — the read-only browser for the whole tree.
- [`plan`](./plan.md) — the other review page: a plan before the code is written.
