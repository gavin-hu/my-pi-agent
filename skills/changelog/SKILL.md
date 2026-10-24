---
name: changelog
description: "Maintain a project's changelog: record one user-visible bullet per change in the same commit, audit the commits since the last tag for missing or weak entries, and curate a release section from the project's own rules. Works with any Keep a Changelog file; use when adding an entry, auditing a changelog, or preparing release notes, not for ordinary code edits."
compatibility: "Bun for scripts/state.ts; git for the audit."
---

# Maintain the changelog

Goal: keep one changelog file honest — a bullet for every user-visible change,
records that have shipped, and a release section cut from the project's own rules.
This is a procedure, not a second policy: the project's instructions and release
document win, and where they are silent this file says ask.

## Pick the mode

| The words after `/skill:changelog` | Mode | Writes | Follow |
|---|---|---|---|
| nothing | record | yes | [`references/bullets.md`](./references/bullets.md) |
| `audit` | audit | no | [`references/audit.md`](./references/audit.md) |
| `release <version>` | release | yes | [`references/release.md`](./references/release.md) |
| anything else | refuse, and name the three | no | — |

Record is the default because every change needs it; release is the only mode that
touches a version.

## Start here

Run the state script, resolved against this skill's own directory:

```bash
bun <skill>/scripts/state.ts <project-root>
```

It prints the changelog file it found, the last tag and the commits since it, the
`[Unreleased]` categories with counts and line numbers, the empty and duplicate
headings, the scope prefixes in use, and the link refs. That is the state; read the
diffs for judgement, not for counting. When it finds no changelog or no repository,
say so and fall back to discovery by hand.

## Non-negotiables

1. **Discover, don't impose.** The project's category spelling and order, scope
   prefix, bullet shape, and release procedure are the rules — see
   [`references/discovery.md`](./references/discovery.md). State the profile in one
   paragraph before editing, and ask when two sources disagree.
2. **One bullet per user-visible outcome**, in the same commit as the change. A
   feature and the bug it fixed before release are one bullet; two observable
   changes are two.
3. **Never invent an entry to make an audit look complete.** An absent entry, or an
   empty list of findings, is a valid result.
4. **Audit reads; it does not edit.** Release moves only what is already written.
5. **Ship the change, not the bullet alone.** Whatever the change makes stale — a
   catalog row, a guide, a config default — moves in the same commit.

## Modes

- **Record**: append one bullet under `[Unreleased]` in the project's category,
  re-reading the file first and preserving other bullets; never create a second
  category heading.
- **Audit**: every commit since the last tag, whether a user can observe it, which
  bullet covers it, and the action. No edit unless the user asks for one.
- **Release**: only for a version the user named, and only after the project's
  release document has been read; everything after moving the entries follows it.

## Quality gate

- The project's own check passes, including any release-consistency test.
- Every bullet names a scope in the project's spelling and a user outcome.
- No empty category, no duplicate heading, no entry under a heading that already
  shipped.
- Link refs and versions agree with the file's newest dated heading.

## Report and stop

Say what was recorded, what the audit found, or what the release moved; list what
was deliberately left out and why, and when nothing qualifies, say so. Stop and ask
before editing when the project's rules are missing or contradictory.
