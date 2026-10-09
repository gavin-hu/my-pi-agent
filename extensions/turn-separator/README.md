# turn-separator — a labeled dashed line between completed turns

`turn-separator` draws a centered, width-adaptive rule in the transcript after
each completed user turn. Pi has no built-in separator between turns and exposes
no setting for one. It is independent of the other extensions in this package.

```
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ turn 3 ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
```

```bash
pi --extension ./extensions/turn-separator   # load just this extension
pi -e .                                      # load the whole @gavin-hu/my-pi-agent package
pi install ./                                # install the package
```

## What it does

- On every fully settled agent run, appends an inert custom session entry and
  renders it as a dashed line labeled `turn N`.
- The line fills the transcript width and stays centered; on a terminal too
  narrow for the label it degrades to a plain dashed rule rather than
  overflowing.
- The stored entry is excluded from LLM context, so it costs no tokens.

## Behaviour by mode

Installed only in interactive (`tui`) sessions. RPC, JSON, and print sessions
load the extension and append nothing, so their session logs stay clean.

## Configuration

Edit `config.ts` to change the glyph (`╌`, `┈`, `─`, ASCII `-`), the label
prefix, padding, or the dash/label theme colors. There is no runtime command.

## Non-goals

- No runtime command or settings file; edit `config.ts`.
- No suppression of the trailing separator after the final turn. It is a normal
  custom entry and can be removed with tree navigation.

## Pi integration

| Contract | Detail |
|---|---|
| Registration | The default export registers one entry renderer and one `agent_settled` listener; nothing long-lived. |
| Events | `pi.on("agent_settled")` appends the separator. |
| Custom entry | `pi.appendEntry(CONFIG.customType, { turn })`, excluded from LLM context. |
| Renderer | `registerEntryRenderer` returns a component; width is passed to `render`, data comes from the entry. |
| State | The turn number is derived from `ctx.sessionManager.getBranch()`; no module-level counter. |
| Modes | Only `tui` appends; RPC, JSON, and print load inert. |

## Design notes

- **`agent_settled`, not `turn_end`.** An agent run can contain several turns
  (one assistant message per tool-calling round), and `turn_end` fires for each.
  `agent_settled` fires once after a run fully settles — exactly one user turn.
- **Append a custom entry; render it.** `pi.appendEntry()` records durable data
  excluded from LLM context, and `registerEntryRenderer()` draws it. This
  survives resume and fork at zero token cost, unlike a custom message, which
  would be resent to the model.
- **Number by branch, not by a counter.** The turn number is
  `count(separators on the current branch) + 1`, so a resumed or forked session
  continues the parent's numbering and abandoned branches do not leak counts.
- **Degrade, don't clip.** The label is centered with the glyph filling the
  remainder; when it cannot fit, the line becomes a plain dashed rule. Every
  line matches the requested column count, using `visibleWidth` rather than
  string length so wide glyphs and ANSI styling cannot overflow.
- **TTY-only, inert elsewhere.** The append is guarded by `ctx.mode === "tui"`,
  so non-interactive session logs are not seeded with entries only an
  interactive viewer understands.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: register the renderer, append on `agent_settled`. |
| `config.ts` | Glyph, label prefix, padding, and theme color tokens. |
| `format.ts` | Pure `separatorParts` / `separatorLine`. |
| `types.ts` | `TurnSeparatorData`, `SeparatorParts`. |
