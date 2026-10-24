---
name: project-docs
description: "Keep a project's documents true to its tree: a read-only audit of the front door, the roadmap, the contributor path, and the changelog against the code and against each other, then one mode per act that writes — record a changelog bullet in the same commit as the change, curate a release section from the project's own rules, delete a shipped roadmap item and renumber, and sync the README front door. Use when a doc claim looks stale, before a release, or when a change lands owing an entry; prioritisation stays with `next` and structure with `refactor`."
compatibility: "Bun for scripts/state.ts; git for the roadmap and the audit."
---

# Keep the docs true to the tree

Goal: the documents a reader trusts — the front door, the plan of record, the record
of what shipped, and the contributor path — so a claim the tree no longer meets is
found, and each act that needs writing has one owner. This is a procedure, not a
second policy: the project's instructions and release document win, and where they
are silent this file says ask.

A bare `/skill:project-docs` reads and reports. Nothing is written until a mode is
named.

## Pick the mode

| The words after `/skill:project-docs` | Mode | Owns | Writes | Follow |
|---|---|---|---|---|
| nothing | audit | every document, read-only | no | [`references/audit.md`](./references/audit.md) |
| `changelog` | changelog | the unreleased window of the changelog | yes | [`references/changelog.md`](./references/changelog.md) |
| `release <version>` | release | one version's section and link refs | yes | [`references/release.md`](./references/release.md) |
| `roadmap` | roadmap | items, ids, and buckets | yes | [`references/roadmap.md`](./references/roadmap.md) |
| `readme` | readme | the front door and its mirror | yes | [`references/readme.md`](./references/readme.md) |
| anything else | refuse, and name the five | — | no | — |

Audit is the default because the skill spans four documents: a bare invocation that
writes would edit a document nobody asked about.

## Start here

Read [`references/discovery.md`](./references/discovery.md) first, in every mode. It
finds the project's documents, the version's single source, the changelog's local
conventions, the roadmap's rules, the check command, and the guards by name. State
that profile in one paragraph before writing anything; it is how a misread is caught
in a line instead of in a diff.

For the changelog's mechanical half, run the state script, resolved against this
skill's own directory:

```bash
bun <skill>/scripts/state.ts <project-root>
```

It prints the changelog file it found, the last tag and the commits since it, the
`[Unreleased]` categories with counts and line numbers, the empty and duplicate
headings, the scope prefixes in use, and the link refs. That is the state; read the
diffs for judgement, not for counting. When it finds no changelog or no repository,
say so and fall back to discovery by hand.

## Non-negotiables

1. **Discover, don't impose.** The project's document set, category spelling, scope
   prefix, bullet shape, item ids, bucket caps, and release procedure are the rules.
   State the profile in one paragraph, and ask when two sources disagree.
2. **One bullet per user-visible outcome**, in the same commit as the change. A
   feature and the bug it fixed before release are one bullet; two observable
   changes are two.
3. **A shipped item is deleted here, with its reason, never ticked.** A roadmap that
   keeps what already landed describes a tree that no longer exists.
4. **One id per thing, across every document.** A README row, a roadmap item, and a
   changelog entry that name the same feature use the same name. A mismatch is
   reported, never renamed.
5. **A judgement is not a finding.** Positioning, priority, dates, non-goals, and
   contribution policy are the maintainer's: list them and ask.
6. **One owner per artefact.** The changelog belongs here; what to do next belongs to
   the `next` skill; structure belongs to `refactor`.

## Modes

- **Audit** — read-only, five faces: the tree against the docs, the docs against each
  other, the changelog's commit window, the roadmap's own ids and caps, and the front
  door's examples. Every finding names the mode that fixes it.
- **Changelog** — one bullet under the project's category for one user-visible
  outcome, re-reading the file first. It never decides whether something has already
  shipped.
- **Release** — only for a version the user named, and only after the project's
  release document has been read; everything after moving the entries follows it.
- **Roadmap** — re-derived from the commits since the last tag rather than from the
  last tag: shipped items deleted, ids renumbered, every citation and link fixed.
- **Readme** — the front door's catalog rows, counts, examples, and mirror, kept equal
  to the tree; deep detail stays in the project's own guides.

## Handover

- **A changelog entry, an audit, or a release** is this skill: do not look for
  another one.
- **What to do next** is `next`: it triages loose work and broken promises across the
  project, and its candidates are not a doc audit's findings.
- **A structural change to the docs or the code** is `refactor`.
- **Who may contribute, and how** is a decision for the maintainer: ask, and edit
  nothing until it is answered.

## Report

Open with the profile in one paragraph, then:

- **Stale** — the claim, `path:line`, the evidence in the tree, and the mode that
  fixes it.
- **Missing** — a document, a row, an entry, or an item the project's own rules call
  for and the tree does not have.
- **Suggested edit** — the diff or the exact replacement, for the mechanical items
  only, and never applied until the user says so.
- **Needs a decision** — one line each: the question, and what it changes.

Nothing found is a valid result, and the whole report may be empty. Say what was
checked and stop; an audit that invents four entries to look thorough is worse than
one that finds nothing.

## Quality gate

- The project's own check passes, including any guard on the release window, the
  documentation's parity, or the roadmap's ids.
- Every edit names the document and the line, and every bullet names a scope in the
  project's spelling and a user outcome.
- No judgement is smuggled into a diff, and the changelog entry is in the change's
  own commit.

## Stop conditions

- The project has no document beyond a README and no roadmap: say so. Whether to
  adopt one is the maintainer's decision, not an edit.
- Two sources disagree — two changelogs, a version in two places, a roadmap item the
  changelog contradicts: ask instead of averaging them.
- The change would reverse a documented non-goal: it is a decision, and the item is
  listed rather than written.
- The request is really triage or a refactor: name the sibling skill and stop.
