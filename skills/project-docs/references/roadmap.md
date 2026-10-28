# Roadmap

The roadmap is the one document that describes the tree rather than the last release,
so it goes stale two ways: it keeps what already shipped, and it promises what the
tree already does differently. This mode re-derives it and deletes what is done. It
never decides what matters.

Read [`discovery.md`](./discovery.md) first for the file, the item form, the buckets
and their caps, the ledger, and the stated rule for a shipped item. A file with no ids
and no buckets is not a defect to fix: it gets the deletion pass below, and no invented
id scheme.

## Re-derive before editing

```bash
git log --oneline <last-tag>..HEAD
```

Use `HEAD`, or the branch the project documents as its default — a project's branch is
not always `main`. Read the changelog's newest dated heading beside it: the window is
everything that landed, and the release is what a reader has. A project with no tags has
no window at all: re-derive from the newest dated heading and the tree instead, and say
that is what you did. An item is not "shipped" because a branch merged — the tree
decides whether the promise is met, the maintainer decides whether it shipped.

Then, for every item in the file, open the code it names. Three outcomes:

- **The tree does it.** Delete the item, and record the reason where it was — one line
  is enough, and it is what stops the same item being re-added next review. A file with
  its own history or "previous `Now`" section gets the note there instead.
- **The tree does part of it.** Rewrite the item down to the part still missing. A
  condensed item is a finding; a deleted one that was not done is a lost promise.
- **The tree contradicts it** — the approach changed, or the problem was solved another
  way. Delete it with that reason. Parking it as "still available" describes a tree
  that no longer exists.

Never tick an item and leave it. A checklist with finished rows is a changelog written
in the wrong file, and it is what the project's own rule usually forbids.

## Renumber and fix every citation

After a deletion, ids break in four places, and all four move in the same edit:

- The item headings, so a prefix's numbers stay contiguous.
- Every reference elsewhere in the file — a ledger row, a "if only two things ship"
  list, a `P1–P3` range whose endpoints both still resolve.
- Every mention in the guides, the front door, and the instruction file, which is what
  a stale id breaks first because nothing validates it.
- The relative links and `path:line` citations the items carry.

Change an id only when a deletion forces it. Renumbering for tidiness loses the
citations the file's readers already have.

## Keep the buckets honest

- A bucket over the cap the file states is a priority list that stopped being one:
  demote an item rather than widening the cap.
- A horizon whose exit condition has been met gets rewritten, not left as decoration.
- A ledger row whose items have all closed is closed; an open item with no ledger row
  gets one, or it is not part of a promise.

## Numbers belong to the tree

Any count the file states about the code — modules, extensions, tools, screens — is
read from the tree, not adjusted by hand. A project that derives it in a guard has the
count already: run the guard, and change the tree or the guard, never the number. A
project that does not is a finding for the audit, and the fix is a guard.

## Non-goals are decisions

The non-goal list carries a reason per entry. When the changelog, a discussion, or the
audit contradicts one, that is a decision for the maintainer: list it, with the
evidence, and ask. Reversing a documented non-goal is not a roadmap edit, and an item
that needs one reversed says so in the item.

## Report

Every edit named by the item it touched: deleted, rewritten, renumbered, or cited.
Then the items that need a decision, one line each. A roadmap whose window changed and
whose items are all still true is a valid result — say so instead of finding work to
look thorough.

## In this repository

- There is no roadmap here: planned work is a card on the board, and the
  documented limitations, the non-goals, and the 1.0 gates live in
  `docs/architecture.md`. A request to re-derive a roadmap in this repository is a
  question about priorities — say so and stop.
- A limitation that has no card belongs in that page's table, with the condition that
  would reopen it, and the extension's own page states the limitation itself.
- `AGENTS.md` holds the same rule from the other side: work planned but not started is a
  card, never a `TODO` comment or a second list in Markdown.

The paths are named, not linked: a skill is installed into projects that do not
contain them, so a link would point nowhere from the place it is read.
