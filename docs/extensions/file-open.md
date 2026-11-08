# file-open — open a file in the app that owns it

`/open` hands a file or directory to the operating system: the default
application opens it, or the file manager reveals it. The model can do the same
through the `open_path` tool.

- **`/open <path>`** opens it in the OS handler; **`/open -r <path>`** reveals it
  in the file manager.
- **Relative to the session**, so under a [worktree](./worktree.md) `/open .` opens
  the isolated checkout.
- **A pasted path works**: the editor's `@` prefix, quotes, and control
  characters are stripped before it is used.
- **It outlives the session** — the handler runs detached.

## What you can do

| What you want | What to do |
|---|---|
| Open a file | `/open src/uploader.ts` |
| Reveal it in the file manager | `/open -r src/uploader.ts` |
| Open the current folder | `/open .` |
| Open a screenshot or a PDF | `/open docs/report.pdf` |
| Let the model open one | ask it to; the tool is `open_path` |
| Open something outside the project | an absolute path is accepted |

## Try it

```text
/open -r .
```

Your file manager opens with the project selected — from a worktree session, the
worktree root rather than the main checkout.

## Reference

**The command.** `/open [path]` opens, `/open -r [path]` reveals. No path means
the working directory.

**The tool.** `open_path` takes `path` and `reveal`. It is exposed to codemode
scripts only, so the model cannot call it in a normal turn; a script that wants a
file opened has to ask for it explicitly.

**Resolution.** A relative path resolves against the effective working directory.
A missing path is refused before a launcher starts; a launcher that cannot start,
or exits non-zero after starting on macOS and Linux, is reported rather than
silently ignored.

## Limits

- It opens whatever the OS associates with the file; it does not choose an
  application.
- It needs a desktop session — over SSH or in a container there is no handler to
  launch, and the failure is reported.
- The tool is codemode-only; your own `/open` is the everyday path.
- Nothing is read or parsed: opening a 2 GB file is the OS's problem, not Pi's.

## Learn more

- [`file-browse`](./file-browse.md) — read it in the browser instead.
- [`file-read`](./file-read.md) — extract its text instead.
- [`worktree`](./worktree.md) — why `/open .` shows the worktree.
