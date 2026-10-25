# team — the lead's round over the board

`board` owns the cards and never touches the session bus. `team` owns the two actions
that need it: `assign` hands a card to a session that is **already running** and sends
it a handoff, and `reclaim` takes a card back when its owner has gone quiet.

Nothing starts a process. The handoff lands in the peer's inbox, and an armed
`session watch` is what raises its turn — so `assign` is a message, not a launch.

<img src="../../assets/screens/team.png" alt="The Team tab as a dashboard: on the left, a Needs a decision queue of rows with a coloured kind edge, the reason on its own line, and a Reclaim or Claim action on the row edge; on the right, a Teammates list with a state dot, label, you chip, mail badge and a line of what each holds; and one muted Done line under both" width="100%">

*The Team tab: the cards that need the lead, then who is on the team — including an
owner whose label nothing answers to.*

## Capabilities

| Capability | How | What you get |
|---|---|---|
| Hand a feature to a running session | `team` action `assign` | The card is `doing`, owned by that session, and a handoff is in its inbox |
| Tell the peer what to do first | `team` action `assign` with `note` | The handoff carries the card, its paths, its plan, and that line |
| Take a card back | `team` action `reclaim` | The owner clears, the card returns to To do, and its notes stay |
| Keep the round to the bus | `team` | Only `assign` and `reclaim`: no card is created, moved, or finished here — that is `board`'s surface |

## Quickstart

```
lead: session({action:"status"})                        → who is live: billing-core, billing-web
lead: team({action:"assign", card:"4", to:"billing-core", note:"start with the webhook"})
      → #4 handed off to billing-core.
peer: board({action:"plan", card:"4", path:"…"})        → the card records its plan
peer: board({action:"note", card:"4", text:"…"})        → a phase, as it happens
later: team({action:"reclaim", card:"4"})               → #4 reclaimed from billing-core
```

## Tool

`team` is one action-shaped tool. `readOnlyHint: false`, `destructiveHint: true`,
`openWorldHint: false`, `executionMode: "sequential"`.

| Action | Parameters | Behaviour |
|---|---|---|
| `assign` | `card`, `to`, `note?` | Checks the card's preconditions, sends the handoff through `session send` (`kind: "handoff"`), then records the owner |
| `reclaim` | `card` | Clears the owner and returns the card to To do, keeping its notes and plan |

`card` takes `4` or `#4`. `to` is a live session's label or id, as `session status`
lists them — a label that is not live cannot be handed a card, and the send says so.

### The order is the point

`assign` sends **before** it assigns, and each failure leaves a state the report names:

| What failed | What the card is | What the lead reads |
|---|---|---|
| the card is missing, `done`, or held by a third session | untouched | the refusal, with no message sent at all |
| the send | untouched — `todo`, no owner | `#4 was not handed off to billing-core: …`, plus `The card is unchanged.` |
| the assignment, after a successful send | whatever the other writer left | `#4 was handed off to billing-core, but the card changed before it could be assigned: …`, and the peer is told to `board claim` it |

`delivered` in the details means a message file was written for that label — not that
the peer read it.

The owner `assign` records is the **session**, not just its name: before writing the
card it asks `session status` who answers to that label and keeps the id. Ownership
is compared by id first (`lib/board/rules.ts`), so a peer that renames itself still
holds its card; a card assigned by label alone — an older one, or one whose session
the bus could not name — goes back to `reclaim` if its holder renames.

### What the peer does on waking

A handoff is an instruction, not a notification: the peer's notice is headlined
`1 handoff`, carries enough of the body to be actionable, and says the work is
theirs — read it with `session inbox`, record the plan, and start. The card is
already theirs (`assign` wrote the owner), so there is no claim step; the peer
plans, works, notes, and moves it to `done` or `blocked`.

## Security

- The tool writes the board store and calls one other tool (`session`); it starts no
  process, opens no socket, and reads no credential.
- A handoff is a message to another local session, so it carries nothing the board
  would not show: the card's title, paths, plan, and the lead's note.

## Limitations

- **Dispatch cannot start a peer's turn.** If the peer has not armed `session watch`,
  the handoff waits in its inbox until that session reads its mail.
- **`to` must be live.** A session that has shut down cannot be handed a card; its
  cards stay `doing` until someone runs `reclaim`.
- **A label-only owner is fragile.** If the bus could not name the session behind
  `to`, the card records the label, and a rename would need a `reclaim` and a fresh
  handoff.
- **Plan mode makes this unavailable.** `session` is a mutating tool, so while plan
  mode is active the nested call is refused. Assign after the plan is approved.
- **Ownership is advisory.** `assign` does not create a path claim; the peer still
  claims the paths it edits through `session`.

## Pi integration

- **`board`**: the same store, the same cards, the same rules — `team` calls
  `lib/board/` directly, so a card it hands over is one `board` can see. Either
  extension works without the other: without `team` the page still reclaims, and
  without `board` there is nothing to assign.
- **`session-bus`**: the one cross-extension call, through `SESSION_TOOL` in
  `lib/tool-names.ts`, so a rename breaks both sides. A bus that is not loaded makes
  the nested call fail, which is the "card untouched" row above.
- **`plan`**: the handoff names the plan file when one is recorded, so the peer knows
  whether it is executing a plan or writing one.
- **`subagent`**: a child process is a different Pi session; hand a card to a peer
  session, not to a child you started for one question.

## Design notes

- **Two extensions, not one tool with a flag.** `board` is the work list any session
  uses and must work with the bus disabled; `team` is the lead's round and is the only
  thing that needs `session send`. If the round ever stops needing the bus, `team`
  folds back in.
- **Send first.** A card assigned without a message is a card nobody knows about,
  while a message for a card that then changed is one the peer can still claim.
- **`reclaim` lives here, not in `board`.** It is the compensation for a dispatch that
  did not land, so it belongs in the lead's context — and the page offers it too,
  because a card whose owner died has no other way back.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | The factory: gate on `PI_DISABLED_EXTENSIONS`, build the session, register the tool |
| `schema.ts` | The tool's two actions and their parameters |
| `tools.ts` | The dispatch order, the refusals, and the report |
| `dispatch.ts` | The handoff text and the nested `session send` behind a seam |
| `format.ts` | The model-facing text for a handoff, a failed send, a race, and a reclaim |
| `types.ts` | The tool's name, actions, and details |

The store, the rules, and the session identity are `lib/board/` — see
[`lib/README.md`](../../lib/README.md).

## Testing

`test/suite-manifest.ts` declares `team/{dispatch,tools,extension}`: the handoff text
and the transport's two outcomes, the assign/reclaim ordering against a recording
dispatch, and the factory.
