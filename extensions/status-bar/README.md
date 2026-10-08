# status-bar — a two-line colorful footer for Pi

Replaces Pi's built-in footer with one compact, colorful, width-adaptive bar.

```
pi --extension ./extensions/status-bar    # load just this extension
pi -e .                                  # load the whole @gavin-hu/my-pi-agent package
pi install ./                            # install the package
```

## What it does

Two lines, each with a left and right zone:

- **Line 1 — identity:** `pwd` on the left, git state (`⎇ branch · ⧉ worktree`)
  on the right.
- **Line 2 — resources:** the context gauge and usage meters on the left, the
  mode/alert slot (`≡ plan`) trailing after a `│` when present; the model and
  thinking level on the right. The gauge is anchored at column 0, so `%` is
  always in the same place.

```
~/repo/my-pi-agent                                                    ⎇ main · ⧉ smoke
▰▰▰▰▰▰▱▱▱▱ 62%/200k · $0.31 · ↑42k ↓8.0k · R96k CH 87% │ ≡ plan    opus-4.5 · high
```

With no plan mode there is no mode slot, so the `│` is omitted:

```
~/repo/my-pi-agent                                                    ⎇ main · ⧉ smoke
▰▰▰▰▰▰▱▱▱▱ 62%/200k · $0.31 · ↑42k ↓8.0k · R96k CH 87%             opus-4.5 · high
```

As the terminal narrows, segments shrink and drop by priority rather than
clipping:

```
~/repo                                                             ⎇ main · ⧉ smoke
▰▰▰▰▱ 62%/200k · $0.31 · ↑42k ↓8.0k │ ≡ plan              opus-4.5
```

```
~/repo                                                     ⎇ · ⧉
▰▰▱ 62% · $0.31 │ ≡ plan                      opus-4.5
```

## Command

| Command | What it does |
|---|---|
| `/status-bar` | Toggle between the custom bar and Pi's built-in footer. |

## Content and colors

| Segment | Line / zone | Color | Drops |
|---|---|---|---|
| pwd | 1 left | dim | last |
| branch | 1 right | purple (warning when detached) | last |
| worktree | 1 right | success | first |
| context gauge + `%` | 2 left | success ≤70 · warning 71–90 · error >90 | never |
| `/window` | 2 left | dim | before cost |
| cost | 2 left | muted | after tokens |
| tokens `↑in ↓out` | 2 left | dim | after cache |
| cache `R… CH …%` | 2 left | dim | first |
| statuses | 2 left | as emitted by each extension | last |
| model | 2 right | accent | never |
| thinking level | 2 right | thinking token | before cost |

Zero-value meters are omitted, so a fresh session shows only the gauge and
window instead of a row of `$0.00 · ↑0 ↓0 · R0 W0`. Unknown context usage shows
a muted `?` rather than the success color. `cost` keeps two decimals below
`$0.1` in its compact form, and a positive sub-cent spend shows as `<$0.01`
rather than `$0.00`.

The worktree status is read from the `worktree` status key, so the
[worktree](../worktree/) extension and the bar agree. The leading slot shows
plan-style alerts when present and is omitted otherwise. A plan chip's trailing
plan file name is dropped, so the slot reads `≡ plan` even though the built-in
footer keeps the name. The slot trails the
meters after a `│`, so the context gauge always starts the line.

## Behaviour by mode

The bar is installed only in interactive (`tui`) sessions. In RPC, JSON, and
print modes the extension loads and does nothing visible.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: install/restore the footer, `/status-bar`. |
| `config.ts` | Thresholds, gauge glyphs, separators, icons, status keys. |
| `types.ts` | `StatusSnapshot`, `Segment`, `LineSpec`, footer/TUI shapes. |
| `snapshot.ts` | Gather data; memoized usage/cost/cache scan. |
| `format.ts` | Pure formatters (tokens, cost, cwd, gauge, colors). |
| `lines.ts` | Snapshot → two `LineSpec`s; status routing. |
| `layout.ts` | Width reduction and right-zone folding. |
| `footer.ts` | `StatusBar` component and footer factory. |
