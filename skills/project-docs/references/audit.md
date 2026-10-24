# Audit

Read-only. The audit answers one question per claim: is this still true, and if not,
which mode fixes it? It never edits — not even a typo, not even "while we are here".
If the user asks for the fixes, finish the report first, then enter the mode it names.

Read [`discovery.md`](./discovery.md) first and open the report with the profile. The
five faces below are a reading order, not a checklist: a face with no evidence
produces no findings.

## 1. The tree against the docs

The claims a reader acts on: a catalog row, a limit stated in a package README, a
default in a configuration table, a roadmap item, a non-goal, a "supported format"
list. For each, find the code that does it — the registration, the branch, the config
default — and name where it disagrees.

| Where the claim lives | What falsifies it |
|---|---|
| A catalog row or feature bullet | The tool, command, flag, or route no longer registers |
| A limitations section | The gap was closed, or widened, and the text did not move |
| A configuration default | The loader's default differs from the table |
| A roadmap item | The tree already does it (see face 4) |
| A non-goal | The changelog records the thing being shipped anyway |

## 2. The docs against each other

- **Counts** — a number a doc states about the code (modules, tools, extensions,
  screens) belongs to the tree. A project that derives it in a test has the count; one
  that does not is a finding, and the fix is a guard, not a number.
- **Catalog rows** — every row names a thing that exists; every existing thing the
  catalog claims to cover has a row. Both directions.
- **Cross-reference ids** — the same feature named in a front-door row, a roadmap item,
  and a changelog entry. Report a mismatch; never rename one side to match.
- **The version** — the source of truth, the newest dated changelog heading, the tag,
  and any badge, badge-adjacent prose, or install instruction that repeats it.
- **The mirror** — a translated README carries the original's sections, table rows, and
  links. A row that exists in one and not the other is a finding even when the prose is
  deliberately translated.
- **The contributor path** — the commands `CONTRIBUTING.md` tells a newcomer to run,
  against the manifest's `scripts` and the CI workflow's steps. A command the docs promise
  and the manifest does not define is the one stale claim a new contributor hits first,
  and a step CI runs that the docs never mention is the one they skip.

## 3. The changelog's commit window

Run `scripts/state.ts` (see the skill's *Start here*). It gives the file, the last tag,
the commits since it, the `[Unreleased]` categories, and the scopes in use.

When discovery says a tool generates the file, the window's entries live in that tool's
input — the changeset queue, the commit-message convention — so audit those, and report
a missing fragment rather than a missing bullet.

Read every commit it lists: `git show <sha>` for the diff, or the pull request when the
repository squashes. A subject line is not enough — `fix bug` and `wip` hide
user-visible changes, and `feat: rewrite the config loader` is often invisible to users.
For each commit, decide whether a user can observe it, which bullet covers it, whether
that bullet's scope is right, and whether a reader of the bullet alone would know what
changed for them.

| Commit | User-visible | Evidence | Existing entry | Action |
|---|---|---|---|---|
| `3f19a02` | yes | `src/load.ts:42` now rejects an unknown key | — | add |
| `b81c4de` | no | test-only | — | leave |
| `0ad9f12` | yes | retry limit 3 → 5 | `Changed`: "`api`: retries are now bounded" | update: the bullet never names the limit |
| `77e0a1e` | unclear | touches the public `--json` shape | — | ask |

`Action` is one of **add** (user-visible, no bullet), **update** (a bullet exists and is
wrong, unscopeable, or too vague to act on), **leave** (covered, internal, or recorded
under an older release), or **ask** (the outcome depends on intent the diff cannot show).

Report separately:

- Duplicate `##` or `###` headings — some tools render the second as its own section,
  and a reader sees half the entries.
- An empty category heading, or a heading a release guard rejects.
- An `[Unreleased]` section that is missing or empty while the window contains
  user-visible changes.
- An entry for something already shipped under a dated heading: the same outcome twice,
  which reads as a second change.
- A stale link reference pointing at an older tag than the newest dated heading — where
  the file uses link references at all. A generated or non-Keep-a-Changelog file may have
  none, and the state script reports that absence as a missing reference without it being
  a defect.

## 4. The roadmap's own ids and caps

Re-derive the window before judging an item: `git log --oneline <last-tag>..HEAD` plus
the changelog's newest dated heading. A roadmap describes the tree, so work that landed
but has not shipped is already part of what it should describe.

- An item the tree already does is a deletion, with its reason recorded where the item
  was.
- An id used twice, skipped in a sequence, or cited from nowhere the file defines.
- A bucket over the cap the file states; a bucket that keeps growing stops being a
  priority.
- A ledger row whose items all closed, or an open item with no ledger row.
- A relative link or a `path:line` citation that no longer resolves.

## 5. The front door's examples

- The quickstart command, run as written. A command that no longer exists is a stale
  promise, and it is the most expensive one because it is the reader's first step.
- An example that imports, configures, or calls something the code no longer accepts.
- A screenshot or a recording that shows a surface that has since changed.
- A link to a guide that moved, a section anchor that was renamed, or a badge whose
  target is gone.

## Report

Open with the profile, then the four sections from the skill: **Stale**, **Missing**,
**Suggested edit**, **Needs a decision**. Every stale finding carries the document,
`path:line`, the evidence in the tree, and the mode that fixes it. Group by the mode
when there are more than a handful, so the user can act one mode at a time.

Nothing found is a valid result for the whole audit or for any face. Say what was
checked — the files read, the commands run, the commits examined — and stop. An audit
that invents findings to look thorough is worse than one that reports none.

## What the audit cannot see

Name these in a closing line instead of guessing:

- Whether a change is user-visible to someone the diff does not show — a default that
  only matters on one platform, a behavior the docs promised and the tests never
  covered.
- Whether a commit message describes what the code does; only the diff does.
- Whether an item shipped: a merged change to a document is not a release, and only the
  maintainer knows whether the front door's promise is meant to hold today or next
  version.
- Whether a roadmap priority is still right, and whether a non-goal still stands.
