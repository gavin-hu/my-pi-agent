# context — see where the window goes

A read-only report of the context window, with one action hanging off it: when
the conversation is too full, the report is where you decide to compact. It is
command-only on purpose — no tool is declared, so the model's prompt budget is
untouched.

## Capabilities

| Capability | How | What you get |
|---|---|---|
| Window headline | `/context` | Pi's own estimate: tokens, window, percentage, free space, and the auto-compaction threshold with the headroom left before it. |
| Composition breakdown | `/context` | Where the window went — system prompt, active tool definitions, the conversation by role, injected pack context, summaries, and shell output. |
| Guarded compaction | `/context compact [instructions]`, `c` on the screen | Compact from the report without interrupting a streaming turn or a running compaction. |
| Compact result | `/context compact` result | The before and after token counts are reported, so the effect of the compaction is visible. |
| Honest drift | `/context` | The difference between Pi's total and the composition estimate, named instead of hidden by forcing the parts to add up. |
| Compaction history | `/context` | How many compactions the branch has, what the newest one cut from and to, and what its summary costs. |
| Largest messages | `/context` | The five largest single messages, so a report that is mostly one tool result says so. |
| Gauge rendering | the `/context` screen | The window and composition bars show ten or eight cells, colored by the row's category — the same hue in the composition table and in the largest-message list — instead of leaving the reader to infer the shape. |
| Pending total | `/context` after a compaction | The report shows a pending total instead of a fabricated estimate while Pi recalculates the window. |
| Mode coverage | `/context` | A scrollable screen in the TUI, the same facts as plain text in `rpc`, `json`, and `print`. |

## Quickstart

```bash
pi --extension ./extensions/context    # load just this extension
pi -e .                                # load the whole @gavin-hu/my-pi-agent package
pi install ./                          # install the package
```

```text
/context                               # the report
/context compact focus on the parser   # compact from it, with instructions
```

## Commands

One command, two forms: `/context` reports, `/context compact` acts on the
report.

| Command | What it does |
|---|---|
| `/context` | The report: a screen in the TUI, a notification elsewhere |
| `/context compact [instructions]` | Compact from the report; refuses while a turn or a compaction is running, so it never interrupts one. Instructions focus the summary |

### Screen keys

| Key | Action |
|---|---|
| `↑` / `↓`, `j` / `k` | Scroll one line |
| `PgUp` / `PgDn` | Scroll one page |
| `Home` / `End`, `g` / `G` | Jump to the start or the end |
| `c` | Compact after a `y`/`N` confirmation |
| `r` | Re-read the session and repaint |
| `Esc` / `q` | Close the screen |

`c` is refused while the agent is busy — a streaming turn or a compaction
already running: Pi's compaction starts by aborting the active turn, and one
keystroke should not discard a running answer. Wait for the turn (or stop it),
then compact. Pi's built-in `/compact` still aborts when that is what you asked
for.

## Behaviour by mode

`/context` works everywhere. The screen needs `ctx.mode === "tui"`; the other
modes notify the same report as text, including the composition rows and the
largest messages. `/context compact` is the same in every mode and reports through
`ctx.ui.notify` when it finishes or fails.

## How the numbers are computed

The report gives Pi's own estimate first — tokens, window, percentage, free
space, the auto-compaction threshold, and the headroom left before it while
compaction is on — then the composition under a header that names the
composition's own estimate.

It names the difference between Pi's total and the composition estimate instead
of forcing the parts to add up: one line with both figures, `unattributed` when
the host's total is the larger one, and `host counts messages only` before the
first reply, when Pi's fallback leaves the prompt and the tools out. Each bar
rounds to the nearest cell, so a bar sits within half a cell of the percentage
printed beside it; the percentage itself is exact.

## The table is a chart

A row's bar and its percentage wear the hue of its category, and the
largest-message list uses the same table, so a tool result is one colour wherever
it appears. A hue identifies; it never judges — the gauge is the only verdict on
the screen, and the footer's feedback line is the transient one. Labels, token
counts, and notes stay in the body, secondary, and faint roles, so the text still
reads on its own and the colour repeats an order the row already has.

| Category | Hue | Bucket ids |
|---|---|---|
| System prompt | blue (`hue1`) | `system` |
| Tool definitions | purple (`hue2`) | `tools` |
| User messages | pink (`hue3`) | `user` |
| Assistant | green (`hue4`) | `assistant` |
| Tool results | amber (`hue5`) | `toolResults`, the `tool result` rows |
| Everything else | neutral (`meta`, children `faint`) | injected context and its children, summaries, shell output |

A category with no entry — an injected type, a role a future Pi adds — reads
neutral rather than borrowing a hue, so the coloured rows always mean the five
categories above.

| Row | Source |
|---|---|
| Headline (`tokens`, `percent`) | `ctx.getContextUsage()`: the last valid provider usage plus Pi's estimate of the messages after it. `tokens` is `null` between a compaction and the next successful reply, because the last usage describes the pre-compaction context. |
| Window | `getContextUsage().contextWindow`, then the active model's `contextWindow`. |
| Headroom | `window - reserve - tokens`, `null` when the total is unknown or automatic compaction is off — there is no threshold in effect. |
| System prompt | A `system` message in the projection when one exists, otherwise `ctx.getSystemPrompt()` at characters/4. |
| Tool definitions | `pi.getAllTools()` filtered to `pi.getActiveTools()`, over each active tool's name, description, and parameter schema at characters/4. `promptGuidelines` are counted in the system prompt instead, because Pi renders them into its rules section. |
| Conversation rows | `sessionManager.buildSessionProjection().messages`, each counted with Pi's own `estimateTokens` (characters/4; an image is 4800 characters; a tool call is its name plus its JSON arguments). |
| Injected context | `custom` messages grouped by `customType`, biggest first; the five largest types are named and the rest fold into one row. |
| Largest messages | The five highest `estimateTokens` values in the projection, each with its role and a bounded descriptor: a tool name, a custom type, a command, or the first line of text. |
| Threshold | `compaction.modelOverrides["provider/id"]`, then `compaction`, then `DEFAULT_COMPACTION_SETTINGS` — the same three-step fallback Pi uses. |
| Compaction history | `getLatestCompactionEntry(branch)` and the branch's `compaction` count. The summary's cost is the summary text at characters/4. |
| Drift | `tokens - estimate`, printed with both figures. A positive value appends `+… unattributed` — usage the rows do not explain; a negative one appends `host counts messages only` while the projection holds no assistant message, because Pi's message-only fallback omits the system prompt and the tool definitions. |

## Limitations

- The composition is an estimate. A provider tokenizer differs from characters/4,
  images are a fixed guess, and the system prompt is measured from its string, so
  the rows will not exactly equal the headline. The drift row is the honest
  difference, not a rounding bug.
- Right after a compaction `tokens` is unknown until the next reply. The screen
  shows the composition estimate and says the total is pending.
- The report is a snapshot. It is re-read when the screen opens, on `r`, and after
  a compaction; it does not watch the session.
- Tool definitions are estimated from the schemas, not from the rendered prompt, so
  a host that formats them differently will move the drift.
- Before the session's first reply, Pi's total is a message-only estimate: it
  leaves out the system prompt and tool definitions, so the rows can exceed it.
  Once a reply exists the host total includes them.
- Without a model whose `contextWindow` is known there is no threshold to show;
  the report says so and leaves compaction to Pi.
- A percentage is computed from unrounded tokens and shown to one decimal, while
  the token column is compact (`5.1k`), so re-deriving a percentage from the
  printed figures can differ by a couple of points. A bar rounds to the nearest
  cell and a non-zero share always gets one, so a `0.2%` row draws one cell
  beside its label.
- Descriptors in **Largest messages** are one line, clipped to 40 characters; a
  long tool result is represented by its tool name, not its content.

## Non-goals

- No automatic compaction policy: Pi owns the threshold, and this extension only
  reports it and forwards a manual request.
- No tokenizer API call, no provider SDK, and no network.
- No trimming, editing, or pinning of individual messages.
- No second `/compact`: the guarded compact is the screen's own action, not a
  replacement.
- No persistent widget; unlike `goal`/`todo`, nothing is added to the rails.

## Pi integration

| Contract | Detail |
|---|---|
| Registration | The default export registers the `/context` command and nothing else, behind the `PI_DISABLED_EXTENSIONS` gate. No tool, no flag, no shortcut, no session hook. |
| Tool surface | None. Command-only, so there is no `promptSnippet`, `annotations`, `executionMode`, or `outputSchema`. |
| Host reads | `ctx.getContextUsage()`, `ctx.getSystemPrompt()`, `ctx.model`, `ctx.isIdle()`, `ctx.sessionManager.buildSessionProjection()` / `getBranch()`, `pi.getActiveTools()` / `getAllTools()` / `getSettings()`. All in `collect.ts`. |
| Action | `ctx.compact({ customInstructions, onComplete, onError })`. It is fire-and-forget; the callbacks repaint the screen or notify the command's caller. |
| State | None. The report is derived from the live session on demand, so `/resume` and `/tree` need no replay and nothing can drift. |
| UI | `ctx.ui.custom` behind `ctx.mode === "tui"` and `withRailsSuppressed`; `ctx.ui.notify` elsewhere. |
| Plan mode | `/context` is usable while planning. `/context compact` mutates the session; commands are user-initiated and are not gated by the read-only tool policy. |

## Design notes

- **The headline is the host's, the parts are ours.** Pi already computes a
  context estimate that blends the last provider usage with a trailing estimate;
  recomputing it would be a second policy. The report reads it and then labels
  its own composition as an estimate, with `drift` as the visible difference.
- **One collector.** `getContextUsage()` rebuilds the session projection, and the
  composition needs that projection too, so `collect.ts` reads once per open or
  refresh. The screen holds the report; arrow keys only move a slice.
- **The threshold is resolved, not approximated.** The report repeats Pi's
  three-step fallback rather than reading only the shared setting, because
  predicting the wrong threshold is worse than not predicting one.
- **A guarded compact, not a second one.** `/compact` is Pi's; `/context compact`
  exists so the report's action works in every mode, and it adds the one guard
  that matches this package's "never lose work" rule: it will not abort a turn.
- **Sanitized at the boundary.** Custom types, message text, and tool names are
  model- or extension-authored, so every descriptor goes through `sanitizeLine`
  before it is painted.
- **A docked screen with a clamped body.** The frame follows
  `lib/tui/chrome.ts` and `lib/tui/cursor.ts`, and the body budget leaves the hint
  row visible on a short terminal.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Factory: the `PI_DISABLED_EXTENSIONS` guard and command registration. |
| `commands.ts` | `/context` and `/context compact`: the TUI mount, the text fallback, and the idle guard. |
| `collect.ts` | The host boundary: one read of usage, prompt, tools, settings, projection, and branch. |
| `report.ts` | The pure builder: composition, reserve resolution, compaction history, largest messages. |
| `format.ts` | The plain-text report for non-TUI modes. |
| `view/context-report.ts` | `ContextComponent`: gauge, rows, scroll, confirmation, feedback, loaded on first use. |
| `types.ts` | `ContextInputs`, `ContextReport`, buckets, and the host types named through `ReturnType<…>`. |

## Testing

`bun test extensions/context` covers the pure report (composition, the reserve
fallback chain, an unknown window, a missing host total, drift in both
directions, compaction history, and descriptor clipping/sanitization), the
screen (width safety at five widths, scroll, refresh, the confirmation, a
running-turn refusal, and failures), and the extension surface (one command, no
tool, the disabled switch, and every command path) through
`test/helpers/fixtures/context.ts`.
