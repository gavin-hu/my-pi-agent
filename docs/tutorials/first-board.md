# Your first board

The board is a shared list of features for one repository. This walkthrough takes
one feature from an idea to `done`, through the two signatures it needs on the
way.

You need Pi and this package installed — see [Install](../install.md).

## Open the board

```text
/board
```

The first session in a repository serves the page on `127.0.0.1`; every other
session opens the same page instead of a second one. The page is a **view** — it
reads the cards and cannot change them, so the terminal and the browser cannot
disagree.

Two tabs: **Board**, the five lanes, and **Team**, the people holding cards.
Opening a card shows its contract, the plan it is executed against, and its
notes, newest first.

## Put a feature on it

```text
board add "Billing webhook accepts orders" paths ["src/billing"]
```

The card comes back as one line:

```text
#1 backlog · Billing webhook accepts orders
```

A new card lands in `backlog` — the pool nobody holds. `paths` are hints about
where the work lives; `priority` is `high`, `normal`, or `low`; `type` is
`feature`, `bug`, `refactor`, `docs`, `test`, or `chore`; `breaking` marks a change
an existing user must act on. `edit` links one card to another with `dependsOn`.

## Take it and design it

```text
board claim 1
```

The card is yours, in `plan`, and the result names the next step: design it in
plan mode, save the plan, then record what the card promises.

```text
/plan add the webhook endpoint and its signature check
```

Approving the plan seeds your todo list and leaves plan mode. Next, record what
the card promises — `goal`, `acceptance`, `scopeOut`, and the plan file itself:

```text
board contract 1 \
  path ~/.pi/agent/plans/a1f9c02/2026-11-08-2140-webhook.md \
  goal "A retried delivery is accepted once" \
  acceptance "A duplicate event id returns 200 and writes nothing" \
  scopeOut "No new event types"
```

The plan file must exist in this repository's plan store. `plan` and `execute`
hold a limited number of cards: three in `plan` and five in `execute` by default,
so a claim says "make room" instead of piling up work.

## Pass the two gates

A card cannot enter `execute` until its contract is approved, and cannot finish
until the work is spot-checked. Both signatures are the lead's — `board.lead`,
`lead` by default — and the person at the keyboard is the other way in:

```text
/board approve 1        approved by you
board move 1 execute
```

Work happens now. Notes are how the card explains itself:

```text
board note 1 "Signature check covers the retry path; fixture added"
```

When the work is done, the lead — or you — looks at it once:

```text
/board review 1
board move 1 done
```

A session never signs a card it holds: it releases the card before signing. You
can sign your own, because the slash commands above write the person's signature,
not the session's. Every sign tells the owner over the session bus, so the person
waiting knows the lane opened.

## Look at it from the page

`/board` stays live: a card a session claimed, moved, or noted shows up without a
reload. Filter the cards, fold `done` away, or open the **Team** tab to see who
is live, quiet, or gone — and which cards are waiting on a decision.

## Set finished work aside

```text
/board archive
```

`done` cards leave the board for an archive that keeps their notes and plan. A
finished card an open card still waits on stays where it is, and the command
says which.

## Where to go next

- [`board`](../extensions/board.md) — the lanes, the actions, and the limits.
- [`team`](../extensions/team.md) — handing a card to a peer, and the round.
- [`plan`](../extensions/plan.md) — the plan the contract points at.
- [`session-bus`](../extensions/session-bus.md) — the bus every sign travels on.
