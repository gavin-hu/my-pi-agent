# turn-separator — a labeled dashed line between completed turns

Pi has no built-in separator between conversation turns. This extension draws a
centered rule in the transcript after each completed user turn:

```
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ turn 3 ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
```

```bash
pi --extension ./extensions/turn-separator   # load just this extension
pi -e .                                    # load the whole @gavin-hu/my-pi-agent package
pi install ./                              # install the package
```

## What it does

On every completed turn (`agent_settled`), it appends a custom session entry and
a registered renderer draws it as a width-adaptive dashed line labeled
`turn N`. The entry is stored in the session but excluded from LLM context, so
it costs no tokens.

`agent_settled` — not `turn_end` — is the boundary. `turn_end` fires once per
assistant message, so every tool-calling round would draw a line; a settled run
is exactly one user turn.

The line fills the transcript width and stays centered. On a terminal too
narrow for the label it degrades to a plain dashed rule rather than overflowing.

## Behaviour by mode

Installed only in interactive (`tui`) sessions. RPC, JSON, and print sessions
load the extension and append nothing, so their session logs stay clean.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: register the renderer, append on `agent_settled`. |
| `config.ts` | Glyph, label prefix, padding, and theme color tokens. |
| `format.ts` | Pure `separatorParts` / `separatorLine`. |
| `types.ts` | `TurnSeparatorData`, `SeparatorParts`. |

## Configuration

Edit `config.ts` to change the glyph (`╌`, `┈`, `─`, ASCII `-`), the label
prefix, padding, or the dash/label theme colors. There is no runtime command.
